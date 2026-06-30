import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stocksRouter from "./stocks";
import marketRouter from "./market";
import watchlistRouter from "./watchlist";
import compareRouter from "./compare";
import riskRadarRouter from "./risk-radar";
import adminRouter from "./admin";
import picksRouter from "./picks";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/stocks", stocksRouter);
router.use("/market", marketRouter);
router.use("/watchlist", watchlistRouter);
router.use("/compare", compareRouter);
router.use("/risk-radar", riskRadarRouter);
router.use("/admin", adminRouter);
router.use("/picks", picksRouter);

export default router;
