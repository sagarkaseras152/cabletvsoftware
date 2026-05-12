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
    ],
  };
}

router.get("/overview", async (req, res) => {
  const [nodes, routes, customers] = await Promise.all([
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
  ]);

  res.json({
    ok: true,
    items: {
      nodes,
      routes,
      insights: buildSmartInsights(nodes, routes, customers),
    },
  });
});

router.post("/nodes", async (req, res) => {
  const {
    type = "joint",
    name,
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

  if (!name || latitude === undefined || longitude === undefined) {
    return res.status(400).json({ ok: false, message: "name, latitude and longitude are required" });
  }

  const item = await prisma.networkNode.create({
    data: {
      id: `node-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      tenantId: req.context.tenantId,
      type,
      name,
      latitude: toNumber(latitude),
      longitude: toNumber(longitude),
      photoDataUrl: String(photoDataUrl || "").trim() || null,
      note: String(note || "").trim() || null,
      fiberCoreCount: fiberCoreCount !== null && fiberCoreCount !== "" ? Number(fiberCoreCount) : null,
      splitterRatio: String(splitterRatio || "").trim() || null,
      capacity: capacity !== null && capacity !== "" ? Number(capacity) : null,
      colorCode: String(colorCode || "").trim() || null,
      relatedCustomerId: String(relatedCustomerId || "").trim() || null,
      parentNodeId: String(parentNodeId || "").trim() || null,
      status: "active",
    },
  });

  res.status(201).json({ ok: true, item });
});

router.post("/routes", async (req, res) => {
  const {
    name,
    routeType = "distribution",
    coreCount = 0,
    cableType = "",
    colorCode = "",
    startNodeId = "",
    endNodeId = "",
    note = "",
    points = [],
  } = req.body || {};

  if (!name || !Array.isArray(points) || points.length < 2) {
    return res.status(400).json({ ok: false, message: "name and at least 2 route points are required" });
  }

  const normalizedPoints = points.map((item) => ({
    lat: toNumber(item.lat),
    lng: toNumber(item.lng),
  }));

  const item = await prisma.fiberRoute.create({
    data: {
      id: `route-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      tenantId: req.context.tenantId,
      name,
      routeType,
      coreCount: Number(coreCount || 0),
      cableType: String(cableType || "").trim() || null,
      colorCode: String(colorCode || "").trim() || null,
      startNodeId: String(startNodeId || "").trim() || null,
      endNodeId: String(endNodeId || "").trim() || null,
      note: String(note || "").trim() || null,
      pathJson: JSON.stringify(normalizedPoints),
      lengthMeters: measureRouteMeters(normalizedPoints),
      status: "active",
    },
  });

  res.status(201).json({ ok: true, item });
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
