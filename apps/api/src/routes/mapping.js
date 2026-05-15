import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCapacity(node) {
  if (node.capacity) return Number(node.capacity);
  if (!node.splitterRatio) return 0;
  const parts = String(node.splitterRatio).split(":");
  return Number(parts[1] || 0) || 0;
}

function haversineMeters(aLat, aLng, bLat, bLng) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earth = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.sqrt(x));
}

function measureRouteMeters(points = []) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const current = points[index];
    total += haversineMeters(prev.lat, prev.lng, current.lat, current.lng);
  }
  return Math.round(total);
}

function parseRatioCapacity(ratio = "") {
  const parts = String(ratio || "").split(":");
  return Number(parts[1] || 0) || 0;
}

function normalizeNodeType(payload = {}) {
  if (payload.type) return String(payload.type).trim();
  if (payload.relatedCustomerId) return "customer_endpoint";
  const source = `${payload.name || ""} ${payload.note || ""}`.toLowerCase();
  if (source.includes("splitter")) return "splitter";
  if (source.includes("fd")) return "fd_box";
  if (source.includes("olt")) return "olt";
  if (source.includes("pole")) return "pole";
  return "joint";
}

function nearestNodeForPoint(nodes, point, types = []) {
  const pool = types.length ? nodes.filter((item) => types.includes(item.type)) : nodes;
  return pool
    .map((item) => ({
      ...item,
      distanceMeters: haversineMeters(point.lat, point.lng, item.latitude, item.longitude),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)[0] || null;
}

function suggestParentNode(nodes, latitude, longitude) {
  const splitters = nodes.filter((item) => item.type === "splitter" || item.type === "fd_box");
  const nearest = splitters
    .map((item) => ({
      ...item,
      distanceMeters: haversineMeters(latitude, longitude, item.latitude, item.longitude),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)[0];
  if (!nearest) return null;
  return nearest.distanceMeters <= 250 ? nearest : null;
}

function inferRouteType(points, startNode, endNode) {
  const endpointTypes = [startNode?.type, endNode?.type].filter(Boolean);
  if (endpointTypes.includes("customer_endpoint")) return "drop";
  if (endpointTypes.includes("olt")) return "feeder";
  if (points.length > 6) return "feeder";
  return "distribution";
}

function inferRouteColor(routeType) {
  const colorMap = {
    feeder: "#1450a3",
    distribution: "#1b7f5a",
    drop: "#b0561f",
  };
  return colorMap[routeType] || "#0b57d0";
}

function inferCoreCount(routeType, provided) {
  if (provided !== undefined && provided !== null && provided !== "") return Number(provided || 0);
  if (routeType === "feeder") return 24;
  if (routeType === "distribution") return 12;
  if (routeType === "drop") return 1;
  return 0;
}

function makeRouteName(routeType, startNode, endNode, sequence = 1) {
  const start = startNode?.name || `Source ${sequence}`;
  const end = endNode?.name || `Target ${sequence}`;
  if (routeType === "drop") return `${start} to ${end} Drop`;
  if (routeType === "feeder") return `${start} to ${end} Feeder`;
  return `${start} to ${end} Fiber`;
}

function normalizeDraftPayload(payload = {}) {
  const routePoints = Array.isArray(payload.routePoints)
    ? payload.routePoints
        .map((item) => ({
          lat: toNumber(item.lat, NaN),
          lng: toNumber(item.lng, NaN),
        }))
        .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng))
    : [];

  const nodeDraft = payload.nodeDraft && Number.isFinite(Number(payload.nodeDraft.latitude)) && Number.isFinite(Number(payload.nodeDraft.longitude))
    ? {
        latitude: toNumber(payload.nodeDraft.latitude),
        longitude: toNumber(payload.nodeDraft.longitude),
      }
    : null;

  return {
    routePoints,
    routeComment: String(payload.routeComment || "").trim(),
    nodeDraft,
    routeMeta: {
      name: String(payload.routeMeta?.name || "").trim(),
      routeType: String(payload.routeMeta?.routeType || "").trim(),
      startNodeId: String(payload.routeMeta?.startNodeId || "").trim(),
      endNodeId: String(payload.routeMeta?.endNodeId || "").trim(),
    },
  };
}

function buildSmartInsights(nodes = [], routes = [], customers = []) {
  const splitters = nodes.filter((item) => item.type === "splitter");
  const endpoints = nodes.filter((item) => item.type === "customer_endpoint");
  const splitterUsage = splitters.map((splitter) => {
    const connected = endpoints.filter((item) => item.parentNodeId === splitter.id).length;
    const capacity = parseCapacity(splitter);
    return {
      id: splitter.id,
      name: splitter.name,
      connected,
      capacity,
      ratio: splitter.splitterRatio || "-",
      overload: capacity > 0 ? connected > capacity : false,
      fillPercent: capacity > 0 ? Math.round((connected / capacity) * 100) : 0,
    };
  });

  const mappedCustomerIds = new Set(endpoints.map((item) => item.relatedCustomerId).filter(Boolean));
  const unmappedCustomers = customers
    .filter((item) => !mappedCustomerIds.has(item.id))
    .slice(0, 10)
    .map((item) => ({
      id: item.id,
      customerCode: item.customerCode,
      name: item.name,
      mobile: item.mobile,
      area: item.area || "-",
    }));

  const endpointsWithoutSplitter = endpoints
    .filter((item) => !item.parentNodeId)
    .map((item) => {
      const nearestSplitter = splitters
        .map((splitter) => ({
          id: splitter.id,
          name: splitter.name,
          distanceMeters: haversineMeters(item.latitude, item.longitude, splitter.latitude, splitter.longitude),
        }))
        .sort((a, b) => a.distanceMeters - b.distanceMeters)[0];

      return {
        id: item.id,
        name: item.name,
        relatedCustomerId: item.relatedCustomerId,
        nearestSplitterName: nearestSplitter?.name || "-",
        nearestDistanceMeters: nearestSplitter ? Math.round(nearestSplitter.distanceMeters) : null,
      };
    })
    .slice(0, 8);

  const routesWithoutNodes = routes
    .filter((item) => !item.startNodeId || !item.endNodeId)
    .slice(0, 8)
    .map((item) => ({
      id: item.id,
      name: item.name,
      routeType: item.routeType,
      coreCount: item.coreCount,
    }));

  return {
    counters: {
      totalNodes: nodes.length,
      totalRoutes: routes.length,
      splitters: splitters.length,
      customerEndpoints: endpoints.length,
      unmappedCustomers: unmappedCustomers.length,
      routesWithoutEndpoints: routesWithoutNodes.length,
    },
    splitterUsage,
    unmappedCustomers,
    endpointsWithoutSplitter,
    routesWithoutNodes,
    suggestions: [
      unmappedCustomers.length
        ? `${unmappedCustomers.length} customers abhi physical map par linked nahi hain.`
        : "Sab visible customers ka endpoint map par linked hai.",
      splitterUsage.some((item) => item.overload)
        ? "Kuch splitters capacity se upar lag rahe hain. Expansion ya rebalance dekhna chahiye."
        : "Current splitter usage stable lag rahi hai.",
      routesWithoutNodes.length
        ? `${routesWithoutNodes.length} fiber routes me start/end node assign karne chahiye.`
        : "Fiber routes ke source-target links healthy lag rahe hain.",
      endpointsWithoutSplitter.length
        ? `${endpointsWithoutSplitter.length} customer endpoints ko nearest splitter se auto-link kiya ja sakta hai.`
        : "Customer endpoints ke nearest parent links stable lag rahe hain.",
    ],
  };
}

router.get("/overview", async (req, res) => {
  const [nodes, routes, customers, draft] = await Promise.all([
    prisma.networkNode.findMany({
      where: { tenantId: req.context.tenantId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.fiberRoute.findMany({
      where: { tenantId: req.context.tenantId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.customer.findMany({
      where: { tenantId: req.context.tenantId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.mappingDraft.findFirst({
      where: { tenantId: req.context.tenantId, draftType: "mapping" },
    }),
  ]);

  res.json({
    ok: true,
    items: {
      nodes,
      routes,
      draft: draft ? normalizeDraftPayload(JSON.parse(draft.draftJson || "{}")) : null,
      insights: buildSmartInsights(nodes, routes, customers),
    },
  });
});

router.post("/draft", async (req, res) => {
  const normalized = normalizeDraftPayload(req.body || {});
  const item = await prisma.mappingDraft.upsert({
    where: {
      tenantId_draftType: {
        tenantId: req.context.tenantId,
        draftType: "mapping",
      },
    },
    create: {
      id: `mapdraft-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      tenantId: req.context.tenantId,
      draftType: "mapping",
      draftJson: JSON.stringify(normalized),
      note: normalized.routeComment || null,
    },
    update: {
      draftJson: JSON.stringify(normalized),
      note: normalized.routeComment || null,
    },
  });

  res.json({ ok: true, item: normalizeDraftPayload(JSON.parse(item.draftJson || "{}")), message: "Mapping draft saved." });
});

router.post("/draft/clear", async (req, res) => {
  await prisma.mappingDraft.deleteMany({
    where: { tenantId: req.context.tenantId, draftType: "mapping" },
  });
  res.json({ ok: true, message: "Mapping draft cleared." });
});

router.post("/nodes", async (req, res) => {
  const {
    type = "",
    name = "",
    latitude,
    longitude,
    photoDataUrl = "",
    note = "",
    fiberCoreCount = null,
    splitterRatio = "",
    capacity = null,
    colorCode = "",
    relatedCustomerId = "",
    parentNodeId = "",
  } = req.body || {};

  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({ ok: false, message: "latitude and longitude are required" });
  }

  const [nodes, relatedCustomer] = await Promise.all([
    prisma.networkNode.findMany({
      where: { tenantId: req.context.tenantId },
    }),
    relatedCustomerId
      ? prisma.customer.findFirst({
          where: { id: String(relatedCustomerId).trim(), tenantId: req.context.tenantId },
        })
      : Promise.resolve(null),
  ]);

  const inferredType = normalizeNodeType({ type, name, note, relatedCustomerId });
  const inferredName = String(name || "").trim()
    || (relatedCustomer ? `${relatedCustomer.name} Endpoint` : `${inferredType.replaceAll("_", " ")} ${nodes.length + 1}`);
  const inferredCapacity = capacity !== null && capacity !== ""
    ? Number(capacity)
    : (splitterRatio ? parseRatioCapacity(splitterRatio) : null);
  const suggestedParent = !parentNodeId && inferredType === "customer_endpoint"
    ? suggestParentNode(nodes, toNumber(latitude), toNumber(longitude))
    : null;

  const item = await prisma.networkNode.create({
    data: {
      id: `node-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      tenantId: req.context.tenantId,
      type: inferredType,
      name: inferredName,
      latitude: toNumber(latitude),
      longitude: toNumber(longitude),
      photoDataUrl: String(photoDataUrl || "").trim() || null,
      note: String(note || "").trim() || null,
      fiberCoreCount: fiberCoreCount !== null && fiberCoreCount !== "" ? Number(fiberCoreCount) : null,
      splitterRatio: String(splitterRatio || "").trim() || null,
      capacity: inferredCapacity,
      colorCode: String(colorCode || "").trim() || null,
      relatedCustomerId: String(relatedCustomerId || "").trim() || null,
      parentNodeId: String(parentNodeId || "").trim() || suggestedParent?.id || null,
      status: "active",
    },
  });

  res.status(201).json({ ok: true, item });
});

router.post("/routes", async (req, res) => {
  const {
    name = "",
    routeType = "",
    coreCount = "",
    cableType = "",
    colorCode = "",
    startNodeId = "",
    endNodeId = "",
    note = "",
    points = [],
  } = req.body || {};

  if (!Array.isArray(points) || points.length < 2) {
    return res.status(400).json({ ok: false, message: "at least 2 route points are required" });
  }

  const normalizedPoints = points.map((item) => ({
    lat: toNumber(item.lat),
    lng: toNumber(item.lng),
  }));
  const nodes = await prisma.networkNode.findMany({
    where: { tenantId: req.context.tenantId },
  });
  const inferredStartNode = startNodeId ? nodes.find((item) => item.id === String(startNodeId).trim()) : nearestNodeForPoint(nodes, normalizedPoints[0]);
  const inferredEndNode = endNodeId ? nodes.find((item) => item.id === String(endNodeId).trim()) : nearestNodeForPoint(nodes, normalizedPoints[normalizedPoints.length - 1]);
  const inferredRouteType = String(routeType || "").trim() || inferRouteType(normalizedPoints, inferredStartNode, inferredEndNode);
  const inferredName = String(name || "").trim() || makeRouteName(inferredRouteType, inferredStartNode, inferredEndNode, nodes.length + 1);

  const item = await prisma.fiberRoute.create({
    data: {
      id: `route-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      tenantId: req.context.tenantId,
      name: inferredName,
      routeType: inferredRouteType,
      coreCount: inferCoreCount(inferredRouteType, coreCount),
      cableType: String(cableType || "").trim() || null,
      colorCode: String(colorCode || "").trim() || inferRouteColor(inferredRouteType),
      startNodeId: String(startNodeId || "").trim() || inferredStartNode?.id || null,
      endNodeId: String(endNodeId || "").trim() || inferredEndNode?.id || null,
      note: String(note || "").trim() || null,
      pathJson: JSON.stringify(normalizedPoints),
      lengthMeters: measureRouteMeters(normalizedPoints),
      status: "active",
    },
  });

  res.status(201).json({ ok: true, item });
});

router.post("/auto/link-endpoints", async (req, res) => {
  const nodes = await prisma.networkNode.findMany({
    where: { tenantId: req.context.tenantId },
  });
  const endpoints = nodes.filter((item) => item.type === "customer_endpoint" && !item.parentNodeId);
  let linked = 0;

  for (const endpoint of endpoints) {
    const parent = suggestParentNode(nodes, endpoint.latitude, endpoint.longitude);
    if (!parent) continue;
    await prisma.networkNode.update({
      where: { id: endpoint.id },
      data: { parentNodeId: parent.id },
    });
    linked += 1;
  }

  res.json({ ok: true, linked, message: `${linked} customer endpoints auto-linked.` });
});

router.post("/auto/fix-routes", async (req, res) => {
  const [nodes, routes] = await Promise.all([
    prisma.networkNode.findMany({ where: { tenantId: req.context.tenantId } }),
    prisma.fiberRoute.findMany({ where: { tenantId: req.context.tenantId } }),
  ]);
  let updated = 0;

  for (const route of routes) {
    const points = JSON.parse(route.pathJson || "[]").filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
    if (points.length < 2) continue;
    const startCandidate = route.startNodeId ? nodes.find((item) => item.id === route.startNodeId) : nearestNodeForPoint(nodes, points[0]);
    const endCandidate = route.endNodeId ? nodes.find((item) => item.id === route.endNodeId) : nearestNodeForPoint(nodes, points[points.length - 1]);
    const nextType = inferRouteType(points, startCandidate, endCandidate);
    await prisma.fiberRoute.update({
      where: { id: route.id },
      data: {
        startNodeId: startCandidate?.id || route.startNodeId || null,
        endNodeId: endCandidate?.id || route.endNodeId || null,
        routeType: nextType,
        colorCode: route.colorCode || inferRouteColor(nextType),
        coreCount: route.coreCount || inferCoreCount(nextType, route.coreCount),
        name: route.name || makeRouteName(nextType, startCandidate, endCandidate, updated + 1),
      },
    });
    updated += 1;
  }

  res.json({ ok: true, updated, message: `${updated} fiber routes auto-optimized.` });
});

router.delete("/nodes/:id", async (req, res) => {
  const existing = await prisma.networkNode.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!existing) return res.status(404).json({ ok: false, message: "Node not found" });

  await prisma.networkNode.delete({ where: { id: existing.id } });
  res.json({ ok: true, message: "Node deleted" });
});

router.delete("/routes/:id", async (req, res) => {
  const existing = await prisma.fiberRoute.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
  });
  if (!existing) return res.status(404).json({ ok: false, message: "Route not found" });

  await prisma.fiberRoute.delete({ where: { id: existing.id } });
  res.json({ ok: true, message: "Route deleted" });
});

export default router;
