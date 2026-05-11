import express, { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const cwmpSessions = new Map();

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function extractXmlValue(payload, tag) {
  const match = payload.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "i"));
  return match?.[1]?.trim() || "";
}

function detectMethod(payload) {
  const known = [
    "Inform",
    "GetRPCMethods",
    "SetParameterValuesResponse",
    "TransferComplete",
    "Empty",
  ];

  if (!payload?.trim()) return "Empty";
  for (const method of known) {
    if (new RegExp(`<(?:\\w+:)?${method}\\b`, "i").test(payload)) return method;
  }
  return "Unknown";
}

function getOntWifiPaths(ont) {
  if (ont.wifiSsidPath && ont.wifiPasswordPath) {
    return {
      ssidPath: ont.wifiSsidPath,
      passwordPath: ont.wifiPasswordPath,
    };
  }

  if ((ont.acsProfile || "").toLowerCase() === "tr098") {
    return {
      ssidPath: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID",
      passwordPath: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase",
    };
  }

  return {
    ssidPath: "Device.WiFi.SSID.1.SSID",
    passwordPath: "Device.WiFi.AccessPoint.1.Security.KeyPassphrase",
  };
}

function buildInformResponse() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soap-env:Body>
    <cwmp:InformResponse>
      <MaxEnvelopes>1</MaxEnvelopes>
    </cwmp:InformResponse>
  </soap-env:Body>
</soap-env:Envelope>`;
}

function buildSetParameterValuesResponse(task, ont) {
  const payload = JSON.parse(task.payload || "{}");
  const { ssidPath, passwordPath } = getOntWifiPaths(ont);
  const commandKey = task.commandKey || `wifi-${Date.now()}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:soap-enc="http://schemas.xmlsoap.org/soap/encoding/">
  <soap-env:Header>
    <cwmp:ID soap-env:mustUnderstand="1">${escapeXml(commandKey)}</cwmp:ID>
  </soap-env:Header>
  <soap-env:Body>
    <cwmp:SetParameterValues>
      <ParameterList soap-enc:arrayType="cwmp:ParameterValueStruct[2]">
        <ParameterValueStruct>
          <Name>${escapeXml(ssidPath)}</Name>
          <Value xsi:type="xsd:string" xmlns:xsd="http://www.w3.org/2001/XMLSchema">${escapeXml(payload.wifiSsid || ont.wifiSsid || "")}</Value>
        </ParameterValueStruct>
        <ParameterValueStruct>
          <Name>${escapeXml(passwordPath)}</Name>
          <Value xsi:type="xsd:string" xmlns:xsd="http://www.w3.org/2001/XMLSchema">${escapeXml(payload.wifiPassword || ont.wifiPassword || "")}</Value>
        </ParameterValueStruct>
      </ParameterList>
      <ParameterKey>${escapeXml(commandKey)}</ParameterKey>
    </cwmp:SetParameterValues>
  </soap-env:Body>
</soap-env:Envelope>`;
}

function getSessionKey(req, serialNumber = "") {
  return `${req.ip || "unknown"}::${serialNumber}`;
}

router.post(
  ["/inform", "/cwmp"],
  express.text({ type: ["application/xml", "text/xml", "text/plain", "*/*"] }),
  async (req, res) => {
    const payload = typeof req.body === "string" ? req.body : "";
    const method = detectMethod(payload);

    if (method === "Inform") {
      const serialNumber = extractXmlValue(payload, "SerialNumber") || extractXmlValue(payload, "serialNumber");
      const manufacturer = extractXmlValue(payload, "Manufacturer") || "unknown";
      const productClass = extractXmlValue(payload, "ProductClass") || "";
      const oui = extractXmlValue(payload, "OUI") || "";

      if (!serialNumber) {
        return res.status(400).json({ ok: false, message: "SerialNumber not found in inform payload" });
      }

      const item = await prisma.ont.findFirst({ where: { serialNumber } });
      if (!item) {
        return res.status(404).json({ ok: false, message: "ONT not mapped in platform", serialNumber });
      }

      const updatedOnt = await prisma.ont.update({
        where: { id: item.id },
        data: {
          vendor: item.vendor || manufacturer,
          model: item.model || productClass,
          macAddress: item.macAddress || oui || item.macAddress,
          status: "online",
          tr069Enabled: true,
          acsDeviceId: item.acsDeviceId || serialNumber,
          lastInformAt: new Date(),
        },
      });

      const pendingTask = await prisma.acsTask.findFirst({
        where: {
          tenantId: updatedOnt.tenantId,
          ontId: updatedOnt.id,
          status: "queued",
        },
        orderBy: { createdAt: "asc" },
      });

      cwmpSessions.set(getSessionKey(req, serialNumber), {
        serialNumber,
        ontId: updatedOnt.id,
        tenantId: updatedOnt.tenantId,
        pendingTaskId: pendingTask?.id || null,
      });

      return res.type("text/xml").send(buildInformResponse());
    }

    if (method === "Empty" || method === "GetRPCMethods" || method === "Unknown") {
      const sessionEntry =
        Array.from(cwmpSessions.entries()).find(([key]) => key.startsWith(`${req.ip || "unknown"}::`)) || null;

      if (!sessionEntry) {
        return res.status(204).send();
      }

      const [, session] = sessionEntry;
      if (!session.pendingTaskId) {
        return res.status(204).send();
      }

      const task = await prisma.acsTask.findUnique({ where: { id: session.pendingTaskId } });
      const ont = await prisma.ont.findUnique({ where: { id: session.ontId } });

      if (!task || !ont || task.status !== "queued") {
        return res.status(204).send();
      }

      const commandKey = task.commandKey || `wifi-${Date.now()}`;
      await prisma.acsTask.update({
        where: { id: task.id },
        data: {
          commandKey,
          status: "dispatched",
          resultMessage: "CWMP SetParameterValues dispatched",
        },
      });

      return res.type("text/xml").send(buildSetParameterValuesResponse({ ...task, commandKey }, ont));
    }

    if (method === "SetParameterValuesResponse") {
      const commandKey = extractXmlValue(payload, "ID");
      const sessionEntry =
        Array.from(cwmpSessions.entries()).find(([key]) => key.startsWith(`${req.ip || "unknown"}::`)) || null;

      if (!sessionEntry) {
        return res.status(204).send();
      }

      const [sessionKey, session] = sessionEntry;
      if (session.pendingTaskId) {
        await prisma.acsTask.updateMany({
          where: {
            id: session.pendingTaskId,
            ...(commandKey ? { commandKey } : {}),
          },
          data: {
            status: "completed",
            resultMessage: "CWMP SetParameterValuesResponse received",
            executedAt: new Date(),
          },
        });
      }

      cwmpSessions.delete(sessionKey);
      return res.status(204).send();
    }

    if (method === "TransferComplete") {
      return res.status(204).send();
    }

    return res.status(204).send();
  },
);

router.use(requireAuth);

router.get("/tasks", async (req, res) => {
  const items = await prisma.acsTask.findMany({
    where: { tenantId: req.context.tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ ok: true, count: items.length, items });
});

router.post("/tasks/wifi", async (req, res) => {
  const { ontId, wifiSsid, wifiPassword } = req.body || {};
  const ont = await prisma.ont.findFirst({
    where: { id: ontId, tenantId: req.context.tenantId },
  });
  if (!ont) return res.status(404).json({ ok: false, message: "ONT not found" });

  const task = await prisma.acsTask.create({
    data: {
      id: `acst-${Date.now()}`,
      tenantId: req.context.tenantId,
      ontId: ont.id,
      taskType: "wifi_update",
      commandKey: `wifi-${Date.now()}`,
      status: ont.tr069Enabled ? "queued" : "device_not_tr069_ready",
      requestedBy: req.context.userId,
      payload: JSON.stringify({ wifiSsid, wifiPassword }),
      resultMessage: ont.tr069Enabled
        ? "Queued for ACS execution"
        : "Device is not marked as TR-069 enabled yet",
    },
  });

  const item = await prisma.ont.update({
    where: { id: ont.id },
    data: {
      wifiSsid: wifiSsid || ont.wifiSsid,
      wifiPassword: wifiPassword || ont.wifiPassword,
      lastProvisionedAt: new Date(),
    },
  });

  res.status(201).json({
    ok: true,
    task,
    item,
    acsEndpoint: "/api/acs/cwmp",
  });
});

export default router;
