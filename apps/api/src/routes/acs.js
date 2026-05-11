import express, { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const cwmpSessions = new Map();
const MAX_RETRIES = 3;

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
    "Fault",
    "Empty",
  ];

  if (!payload?.trim()) return "Empty";
  for (const method of known) {
    if (new RegExp(`<(?:\\w+:)?${method}\\b`, "i").test(payload)) return method;
  }
  return "Unknown";
}

function getOntWifiPaths(ont, settings) {
  if (ont.wifiSsidPath && ont.wifiPasswordPath) {
    return {
      ssidPath: ont.wifiSsidPath,
      passwordPath: ont.wifiPasswordPath,
    };
  }

  if (settings?.defaultWifiSsidPath && settings?.defaultWifiPasswordPath) {
    return {
      ssidPath: settings.defaultWifiSsidPath,
      passwordPath: settings.defaultWifiPasswordPath,
    };
  }

  if ((ont.acsProfile || settings?.defaultAcsProfile || "").toLowerCase() === "tr098") {
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

function buildSetParameterValuesResponse(task, ont, settings) {
  const payload = JSON.parse(task.payload || "{}");
  const { ssidPath, passwordPath } = getOntWifiPaths(ont, settings);
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

function getSessionKey(req, tenantCode = "", serialNumber = "") {
  return `${req.ip || "unknown"}::${tenantCode}::${serialNumber}`;
}

async function logAcsEvent({ tenantId, ontId = null, eventType, serialNumber = null, payload = "", status = "", details = "" }) {
  await prisma.acsEvent.create({
    data: {
      id: `acse-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      tenantId,
      ontId,
      eventType,
      serialNumber,
      payload: payload.slice(0, 5000),
      status,
      details: details.slice(0, 1000),
    },
  });
}

function parseBasicAuth(authHeader = "") {
  if (!authHeader.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
    const [username, password] = decoded.split(":");
    return { username, password };
  } catch {
    return null;
  }
}

async function resolveTenantForAcs(req) {
  if (req.params.tenantCode) {
    const tenant = await prisma.tenant.findUnique({ where: { code: req.params.tenantCode } });
    if (!tenant) return null;
    const settings = await prisma.tenantSetting.findUnique({ where: { tenantId: tenant.id } });
    return { tenant, settings };
  }

  const basic = parseBasicAuth(req.header("authorization") || "");
  if (!basic?.username || !basic?.password) return null;

  const settings = await prisma.tenantSetting.findFirst({
    where: {
      acsUsername: basic.username,
      acsPassword: basic.password,
    },
  });
  if (!settings) return null;

  const tenant = await prisma.tenant.findUnique({ where: { id: settings.tenantId } });
  if (!tenant) return null;
  return { tenant, settings };
}

router.post(
  ["/inform", "/cwmp", "/cwmp/:tenantCode"],
  express.text({ type: ["application/xml", "text/xml", "text/plain", "*/*"] }),
  async (req, res) => {
    const payload = typeof req.body === "string" ? req.body : "";
    const method = detectMethod(payload);
    const tenantBundle = await resolveTenantForAcs(req);

    if (!tenantBundle) {
      return res.status(401).json({ ok: false, message: "ACS tenant authentication failed" });
    }

    const { tenant, settings } = tenantBundle;

    if (method === "Inform") {
      const serialNumber = extractXmlValue(payload, "SerialNumber") || extractXmlValue(payload, "serialNumber");
      const manufacturer = extractXmlValue(payload, "Manufacturer") || "unknown";
      const productClass = extractXmlValue(payload, "ProductClass") || "";
      const oui = extractXmlValue(payload, "OUI") || "";

      if (!serialNumber) {
        await logAcsEvent({
          tenantId: tenant.id,
          eventType: "inform_rejected",
          payload,
          status: "rejected",
          details: "SerialNumber not found",
        });
        return res.status(400).json({ ok: false, message: "SerialNumber not found in inform payload" });
      }

      let item = await prisma.ont.findFirst({
        where: {
          serialNumber,
          tenantId: tenant.id,
        },
      });

      if (!item) {
        item = await prisma.ont.create({
          data: {
            id: `ont-${Date.now()}`,
            tenantId: tenant.id,
            serialNumber,
            vendor: manufacturer,
            model: productClass,
            macAddress: oui || null,
            tr069Enabled: true,
            acsDeviceId: serialNumber,
            acsProfile: settings?.defaultAcsProfile || "tr181",
            wifiSsidPath: settings?.defaultWifiSsidPath || null,
            wifiPasswordPath: settings?.defaultWifiPasswordPath || null,
            status: "online",
            discoveryStatus: settings?.autoApproveOnts === false ? "new_discovered" : "approved",
            informCount: 1,
            lastInformAt: new Date(),
          },
        });
      } else {
        item = await prisma.ont.update({
          where: { id: item.id },
          data: {
            vendor: item.vendor || manufacturer,
            model: item.model || productClass,
            macAddress: item.macAddress || oui || item.macAddress,
            status: "online",
            tr069Enabled: true,
            acsDeviceId: item.acsDeviceId || serialNumber,
            informCount: { increment: 1 },
            lastInformAt: new Date(),
          },
        });
      }

      await logAcsEvent({
        tenantId: tenant.id,
        ontId: item.id,
        eventType: "inform",
        serialNumber,
        payload,
        status: "accepted",
        details: "Device inform accepted",
      });

      const pendingTask = await prisma.acsTask.findFirst({
        where: {
          tenantId: tenant.id,
          ontId: item.id,
          status: "queued",
          OR: [
            { nextRetryAt: null },
            { nextRetryAt: { lte: new Date() } },
          ],
        },
        orderBy: { createdAt: "asc" },
      });

      cwmpSessions.set(getSessionKey(req, tenant.code, serialNumber), {
        serialNumber,
        ontId: item.id,
        tenantId: tenant.id,
        tenantCode: tenant.code,
        pendingTaskId: pendingTask?.id || null,
      });

      return res.type("text/xml").send(buildInformResponse());
    }

    if (method === "Empty" || method === "GetRPCMethods" || method === "Unknown") {
      const sessionEntry =
        Array.from(cwmpSessions.entries()).find(([key]) => key.startsWith(`${req.ip || "unknown"}::${tenant.code}::`)) || null;

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

      await logAcsEvent({
        tenantId: tenant.id,
        ontId: ont.id,
        eventType: "task_dispatch",
        serialNumber: ont.serialNumber,
        status: "dispatched",
        details: `${task.taskType} -> ${commandKey}`,
      });

      return res.type("text/xml").send(buildSetParameterValuesResponse({ ...task, commandKey }, ont, settings));
    }

    if (method === "SetParameterValuesResponse") {
      const commandKey = extractXmlValue(payload, "ID");
      const sessionEntry =
        Array.from(cwmpSessions.entries()).find(([key]) => key.startsWith(`${req.ip || "unknown"}::${tenant.code}::`)) || null;

      if (!sessionEntry) {
        return res.status(204).send();
      }

      const [sessionKey, session] = sessionEntry;
      const task = session.pendingTaskId ? await prisma.acsTask.findUnique({ where: { id: session.pendingTaskId } }) : null;

      if (task) {
        await prisma.acsTask.update({
          where: { id: task.id },
          data: {
            status: "completed",
            resultMessage: "CWMP SetParameterValuesResponse received",
            executedAt: new Date(),
          },
        });
      }

      await logAcsEvent({
        tenantId: tenant.id,
        ontId: session.ontId,
        eventType: "task_complete",
        serialNumber: session.serialNumber,
        payload,
        status: "completed",
        details: commandKey || "SetParameterValuesResponse",
      });

      cwmpSessions.delete(sessionKey);
      return res.status(204).send();
    }

    if (method === "Fault") {
      const faultCode = extractXmlValue(payload, "FaultCode") || "fault";
      const faultString = extractXmlValue(payload, "FaultString") || "CWMP fault";
      const sessionEntry =
        Array.from(cwmpSessions.entries()).find(([key]) => key.startsWith(`${req.ip || "unknown"}::${tenant.code}::`)) || null;

      if (sessionEntry) {
        const [sessionKey, session] = sessionEntry;
        const task = session.pendingTaskId ? await prisma.acsTask.findUnique({ where: { id: session.pendingTaskId } }) : null;

        if (task) {
          const shouldRetry = task.retryCount < MAX_RETRIES;
          await prisma.acsTask.update({
            where: { id: task.id },
            data: {
              status: shouldRetry ? "queued" : "failed",
              retryCount: { increment: 1 },
              nextRetryAt: shouldRetry ? new Date(Date.now() + 5 * 60 * 1000) : null,
              faultCode,
              resultMessage: faultString,
            },
          });
        }

        await prisma.ont.update({
          where: { id: session.ontId },
          data: {
            lastFaultCode: faultCode,
            lastFaultMessage: faultString,
          },
        }).catch(() => {});

        await logAcsEvent({
          tenantId: tenant.id,
          ontId: session.ontId,
          eventType: "fault",
          serialNumber: session.serialNumber,
          payload,
          status: "fault",
          details: `${faultCode} ${faultString}`,
        });

        cwmpSessions.delete(sessionKey);
      }

      return res.status(204).send();
    }

    if (method === "TransferComplete") {
      await logAcsEvent({
        tenantId: tenant.id,
        eventType: "transfer_complete",
        payload,
        status: "received",
        details: "TransferComplete received",
      });
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

router.get("/events", async (req, res) => {
  const items = await prisma.acsEvent.findMany({
    where: { tenantId: req.context.tenantId },
    orderBy: { createdAt: "desc" },
    take: 200,
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
      nextRetryAt: ont.tr069Enabled ? new Date() : null,
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

  await logAcsEvent({
    tenantId: req.context.tenantId,
    ontId: ont.id,
    eventType: "task_queued",
    serialNumber: ont.serialNumber,
    status: task.status,
    details: "WiFi update queued from portal",
  });

  res.status(201).json({
    ok: true,
    task,
    item,
    acsEndpoint: `/api/acs/cwmp/${escapeXml((await prisma.tenant.findUnique({ where: { id: req.context.tenantId } }))?.code || "")}`,
  });
});

router.post("/onts/:id/approve", async (req, res) => {
  const ont = await prisma.ont.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!ont) return res.status(404).json({ ok: false, message: "ONT not found" });

  const item = await prisma.ont.update({
    where: { id: ont.id },
    data: { discoveryStatus: "approved" },
  });
  res.json({ ok: true, item });
});

export default router;
