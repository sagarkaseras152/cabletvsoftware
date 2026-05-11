import express, { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

function extractXmlValue(payload, tag) {
  const match = payload.match(new RegExp(`<${tag}>(.*?)</${tag}>`, "i"));
  return match?.[1]?.trim() || "";
}

router.post(
  "/inform",
  express.text({ type: ["application/xml", "text/xml", "text/plain"] }),
  async (req, res) => {
    const payload = typeof req.body === "string" ? req.body : "";
    if (!payload) {
      return res.status(400).json({ ok: false, message: "ACS inform payload required" });
    }

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

    await prisma.ont.update({
      where: { id: item.id },
      data: {
        vendor: item.vendor || manufacturer,
        model: item.model || productClass,
        macAddress: item.macAddress || oui || item.macAddress,
        status: "online",
        tr069Enabled: true,
        lastInformAt: new Date(),
      },
    });

    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/">
  <soap-env:Body />
</soap-env:Envelope>`);
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

  res.status(201).json({ ok: true, task, item });
});

export default router;
