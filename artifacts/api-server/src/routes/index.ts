import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stocksRouter from "./stocks";
import marketRouter from "./market";
import watchlistRouter from "./watchlist";
import compareRouter from "./compare";
import riskRadarRouter from "./risk-radar";
import adminRouter from "./admin";
import picksRouter from "./picks";
import newsRouter from "./news";
import aiAnalystRouter from "./ai-analyst";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/stocks", stocksRouter);
router.use("/market", marketRouter);
router.use("/watchlist", watchlistRouter);
router.use("/compare", compareRouter);
router.use("/risk-radar", riskRadarRouter);
router.use("/admin", adminRouter);
router.use("/picks", picksRouter);
router.use("/news", newsRouter);
router.use("/ai", aiAnalystRouter);

export default router;
