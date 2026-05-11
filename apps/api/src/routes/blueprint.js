import { Router } from "express";
import { featureChecklist, modules, overview } from "../data/demoData.js";

const router = Router();

router.get("/overview", (req, res) => {
  res.json({
    context: req.context,
    overview,
  });
});

router.get("/modules", (req, res) => {
  res.json({
    context: req.context,
    modules,
    featureChecklist,
  });
});

export default router;
