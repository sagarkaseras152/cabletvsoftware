import { randomBytes } from "crypto";
import { prisma } from "../db.js";

export function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

export function makeIngestKey() {
  return randomBytes(18).toString("hex");
}

export function safeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function safeInt(value) {
  const parsed = safeNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

function average(values) {
  const valid = values.filter((item) => Number.isFinite(item));
  if (!valid.length) return null;
  return valid.reduce((sum, item) => sum + item, 0) / valid.length;
}

export function buildAnalysis(device, snapshots = []) {
  const now = Date.now();
  const lastSeenGapSec = device.lastSeenAt ? Math.floor((now - new Date(device.lastSeenAt).getTime()) / 1000) : null;
  const expectedGap = Number(device.expectedIntervalSec || 300);
  const latest = snapshots[0] || {};
  const recent = snapshots.slice(0, 3);
  const older = snapshots.slice(3, 6);
  const riskReasons = [];
  const predictedIssues = [];
  const activeAlerts = [];
  let riskScore = 0;

  const currentCpu = safeNumber(device.cpuPercent ?? latest.cpuPercent);
  const currentMemory = safeNumber(device.memoryPercent ?? latest.memoryPercent);
  const currentTemp = safeNumber(device.temperatureC ?? latest.temperatureC);
  const currentLatency = safeNumber(device.latencyMs ?? latest.latencyMs);
  const currentPacketLoss = safeNumber(device.packetLossPercent ?? latest.packetLossPercent);
  const currentRx = safeNumber(device.opticalRxPowerDbm ?? latest.opticalRxPowerDbm ?? device.signalPowerDbm ?? latest.signalPowerDbm);
  const currentTx = safeNumber(device.opticalTxPowerDbm ?? latest.opticalTxPowerDbm);
  const currentOnuOffline = safeInt(device.onuOfflineCount ?? latest.onuOfflineCount);
  const currentAlarms = safeInt(device.activeAlarmCount ?? latest.activeAlarmCount);
  const currentDownInterfaces = safeInt(device.interfaceDownCount ?? latest.interfaceDownCount);
  const recentAvgLatency = average(recent.map((item) => safeNumber(item.latencyMs)));
  const olderAvgLatency = average(older.map((item) => safeNumber(item.latencyMs)));
  const recentAvgTemp = average(recent.map((item) => safeNumber(item.temperatureC)));
  const olderAvgTemp = average(older.map((item) => safeNumber(item.temperatureC)));
  const recentAvgRx = average(recent.map((item) => safeNumber(item.opticalRxPowerDbm ?? item.signalPowerDbm)));
  const olderAvgRx = average(older.map((item) => safeNumber(item.opticalRxPowerDbm ?? item.signalPowerDbm)));

  if (lastSeenGapSec !== null && lastSeenGapSec > expectedGap * 2) {
    riskScore += 35;
    riskReasons.push(`Device expected interval se ${lastSeenGapSec}s late report kar raha hai.`);
    activeAlerts.push({
      severity: "critical",
      alertType: "device_silent",
      title: "Device reporting silent",
      detail: `Expected ${expectedGap}s tha, last heartbeat ${lastSeenGapSec}s pehle aaya.`,
    });
    predictedIssues.push("Device disconnect ya management-path issue aa sakta hai.");
  }

  if (currentCpu !== null && currentCpu >= 85) {
    riskScore += 16;
    riskReasons.push(`CPU load ${currentCpu}% tak pahunch gaya hai.`);
    activeAlerts.push({
      severity: currentCpu >= 92 ? "critical" : "warning",
      alertType: "high_cpu",
      title: "High CPU load",
      detail: `Current CPU ${currentCpu}% hai.`,
    });
  }

  if (currentMemory !== null && currentMemory >= 85) {
    riskScore += 14;
    riskReasons.push(`Memory load ${currentMemory}% hai.`);
    activeAlerts.push({
      severity: currentMemory >= 92 ? "critical" : "warning",
      alertType: "high_memory",
      title: "High memory usage",
      detail: `Current memory ${currentMemory}% hai.`,
    });
  }

  if (currentTemp !== null && currentTemp >= 70) {
    riskScore += 18;
    riskReasons.push(`Temperature ${currentTemp}C hai.`);
    activeAlerts.push({
      severity: currentTemp >= 80 ? "critical" : "warning",
      alertType: "high_temperature",
      title: "Device overheating risk",
      detail: `Current temperature ${currentTemp}C detect hui.`,
    });
  }

  if (currentLatency !== null && currentLatency >= 80) {
    riskScore += 12;
    riskReasons.push(`Latency ${currentLatency}ms hai.`);
    activeAlerts.push({
      severity: currentLatency >= 150 ? "critical" : "warning",
      alertType: "high_latency",
      title: "Latency spike",
      detail: `Network latency ${currentLatency}ms report hui.`,
    });
  }

  if (currentPacketLoss !== null && currentPacketLoss >= 2) {
    riskScore += 18;
    riskReasons.push(`Packet loss ${currentPacketLoss}% hai.`);
    activeAlerts.push({
      severity: currentPacketLoss >= 5 ? "critical" : "warning",
      alertType: "packet_loss",
      title: "Packet loss detected",
      detail: `Packet loss ${currentPacketLoss}% tak gayi.`,
    });
  }

  if (currentOnuOffline !== null && currentOnuOffline > 0) {
    riskScore += Math.min(20, currentOnuOffline * 2);
    riskReasons.push(`${currentOnuOffline} ONU/ONT offline detect hui.`);
    activeAlerts.push({
      severity: currentOnuOffline >= 5 ? "critical" : "warning",
      alertType: "onu_offline",
      title: "ONU offline count rising",
      detail: `${currentOnuOffline} ONU/ONT currently offline report hui.`,
    });
    predictedIssues.push("Splitter, feeder fiber ya local power issue impact create kar sakta hai.");
  }

  if (currentAlarms !== null && currentAlarms > 0) {
    riskScore += Math.min(18, currentAlarms * 3);
    riskReasons.push(`${currentAlarms} active alarms device par present hain.`);
    activeAlerts.push({
      severity: currentAlarms >= 3 ? "critical" : "warning",
      alertType: "active_alarms",
      title: "Device alarms active",
      detail: `${currentAlarms} active alarms currently visible hain.`,
    });
  }

  if (currentDownInterfaces !== null && currentDownInterfaces > 0) {
    riskScore += Math.min(16, currentDownInterfaces * 2);
    riskReasons.push(`${currentDownInterfaces} interfaces down report hui.`);
    activeAlerts.push({
      severity: currentDownInterfaces >= 4 ? "critical" : "warning",
      alertType: "interfaces_down",
      title: "Interface down events",
      detail: `${currentDownInterfaces} interfaces down state me hain.`,
    });
  }

  if (device.deviceType === "ont" || device.deviceType === "olt") {
    if (currentRx !== null && currentRx <= -27) {
      riskScore += 24;
      riskReasons.push(`Optical receive power ${currentRx} dBm hai jo weak side par hai.`);
      activeAlerts.push({
        severity: currentRx <= -30 ? "critical" : "warning",
        alertType: "low_optical_rx",
        title: "Low optical receive power",
        detail: `ONT/OLT optical receive power ${currentRx} dBm detect hui.`,
      });
      predictedIssues.push("Fiber bend, dirty connector, splitter loss ya cut risk ho sakta hai.");
    }

    if (currentTx !== null && currentTx >= 5) {
      riskScore += 10;
      riskReasons.push(`Optical transmit power ${currentTx} dBm hai.`);
      activeAlerts.push({
        severity: "warning",
        alertType: "high_optical_tx",
        title: "Transmit power outlier",
        detail: `Optical TX power ${currentTx} dBm detect hui.`,
      });
    }
  }

  if (recentAvgTemp !== null && olderAvgTemp !== null && recentAvgTemp - olderAvgTemp >= 8) {
    riskScore += 10;
    predictedIssues.push("Temperature trend fast upar ja rahi hai, fan/airflow ya cabinet heat issue aa sakta hai.");
  }

  if (recentAvgLatency !== null && olderAvgLatency !== null && recentAvgLatency - olderAvgLatency >= 25) {
    riskScore += 10;
    predictedIssues.push("Latency degrade trend chal rahi hai, uplink congestion ya interface error aa sakta hai.");
  }

  if (recentAvgRx !== null && olderAvgRx !== null && recentAvgRx < olderAvgRx - 2) {
    riskScore += 14;
    predictedIssues.push("Optical power trend gir rahi hai, splice loss ya connector contamination check karo.");
  }

  if (String(device.lastEventType || "").toLowerCase().includes("fault")) {
    riskScore += 12;
    riskReasons.push("Recent fault event bhi device history me hai.");
  }

  riskScore = Math.max(0, Math.min(100, Math.round(riskScore)));
  const healthStatus =
    riskScore >= 70 ? "critical" :
    riskScore >= 40 ? "warning" :
    device.status === "online" ? "healthy" : device.status || "unknown";

  return {
    riskScore,
    healthStatus,
    riskReasons,
    predictedIssues: [...new Set(predictedIssues)],
    activeAlerts,
    metrics: {
      cpuPercent: currentCpu,
      memoryPercent: currentMemory,
      temperatureC: currentTemp,
      opticalRxPowerDbm: currentRx,
      opticalTxPowerDbm: currentTx,
      latencyMs: currentLatency,
      packetLossPercent: currentPacketLoss,
      onuOfflineCount: currentOnuOffline,
      activeAlarmCount: currentAlarms,
      interfaceDownCount: currentDownInterfaces,
      lastSeenGapSec,
    },
  };
}

export async function syncAlerts(tenantId, deviceId, analysis) {
  const openAlerts = await prisma.deviceAlert.findMany({
    where: { tenantId, deviceId, status: "open" },
  });
  const openByType = new Map(openAlerts.map((item) => [item.alertType, item]));
  const nextTypes = new Set(analysis.activeAlerts.map((item) => item.alertType));

  for (const alert of analysis.activeAlerts) {
    const existing = openByType.get(alert.alertType);
    if (existing) {
      await prisma.deviceAlert.update({
        where: { id: existing.id },
        data: {
          severity: alert.severity,
          title: alert.title,
          detail: alert.detail,
          lastDetectedAt: new Date(),
        },
      });
    } else {
      await prisma.deviceAlert.create({
        data: {
          id: makeId("dalert"),
          tenantId,
          deviceId,
          severity: alert.severity,
          alertType: alert.alertType,
          title: alert.title,
          detail: alert.detail,
        },
      });
    }
  }

  for (const existing of openAlerts) {
    if (!nextTypes.has(existing.alertType)) {
      await prisma.deviceAlert.update({
        where: { id: existing.id },
        data: {
          status: "resolved",
          resolvedAt: new Date(),
        },
      });
    }
  }
}

export async function recordMonitoringTelemetry(device, payload) {
  const snapshot = await prisma.deviceSnapshot.create({
    data: {
      id: makeId("dsnap"),
      tenantId: device.tenantId,
      deviceId: device.id,
      eventType: payload.eventType || "telemetry",
      status: payload.status || "online",
      cpuPercent: safeNumber(payload.cpuPercent),
      memoryPercent: safeNumber(payload.memoryPercent),
      temperatureC: safeNumber(payload.temperatureC),
      opticalRxPowerDbm: safeNumber(payload.opticalRxPowerDbm),
      opticalTxPowerDbm: safeNumber(payload.opticalTxPowerDbm),
      signalPowerDbm: safeNumber(payload.signalPowerDbm),
      latencyMs: safeNumber(payload.latencyMs),
      packetLossPercent: safeNumber(payload.packetLossPercent),
      voltage: safeNumber(payload.voltage),
      uptimeSeconds: safeInt(payload.uptimeSeconds),
      onuOnlineCount: safeInt(payload.onuOnlineCount),
      onuOfflineCount: safeInt(payload.onuOfflineCount),
      activeAlarmCount: safeInt(payload.activeAlarmCount),
      interfaceDownCount: safeInt(payload.interfaceDownCount),
      message: payload.message ? String(payload.message).slice(0, 500) : null,
      rawPayload: JSON.stringify(payload).slice(0, 4000),
    },
  });

  const recentSnapshots = await prisma.deviceSnapshot.findMany({
    where: { deviceId: device.id, tenantId: device.tenantId },
    orderBy: { createdAt: "desc" },
    take: 6,
  });

  const nextState = {
    ...device,
    ...snapshot,
    lastSeenAt: new Date(),
    status: payload.status || "online",
    lastEventType: payload.eventType || "telemetry",
    lastEventMessage: payload.message || null,
  };
  const analysis = buildAnalysis(nextState, recentSnapshots);

  const updatedDevice = await prisma.monitoredDevice.update({
    where: { id: device.id },
    data: {
      status: payload.status || "online",
      lastSeenAt: new Date(),
      lastPollAt: payload.lastPollAt || undefined,
      lastPollStatusCode: payload.lastPollStatusCode !== undefined ? safeInt(payload.lastPollStatusCode) : undefined,
      pollFailures: payload.pollFailures !== undefined ? safeInt(payload.pollFailures) ?? 0 : undefined,
      cpuPercent: safeNumber(payload.cpuPercent),
      memoryPercent: safeNumber(payload.memoryPercent),
      temperatureC: safeNumber(payload.temperatureC),
      opticalRxPowerDbm: safeNumber(payload.opticalRxPowerDbm),
      opticalTxPowerDbm: safeNumber(payload.opticalTxPowerDbm),
      signalPowerDbm: safeNumber(payload.signalPowerDbm),
      latencyMs: safeNumber(payload.latencyMs),
      packetLossPercent: safeNumber(payload.packetLossPercent),
      voltage: safeNumber(payload.voltage),
      uptimeSeconds: safeInt(payload.uptimeSeconds),
      onuOnlineCount: safeInt(payload.onuOnlineCount),
      onuOfflineCount: safeInt(payload.onuOfflineCount),
      activeAlarmCount: safeInt(payload.activeAlarmCount),
      interfaceDownCount: safeInt(payload.interfaceDownCount),
      lastEventType: payload.eventType || "telemetry",
      lastEventMessage: payload.message ? String(payload.message).slice(0, 500) : null,
      riskScore: analysis.riskScore,
      lastAnalysisJson: JSON.stringify(analysis).slice(0, 4000),
    },
  });

  await syncAlerts(device.tenantId, device.id, analysis);

  return {
    snapshot,
    item: updatedDevice,
    analysis,
  };
}
