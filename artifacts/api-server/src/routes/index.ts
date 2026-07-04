import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminRouter from "./admin";
import authRouter from "./auth";
import { xauusdRouter } from "./xauusd";
import { btcusdRouter } from "./btcusd";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/admin", adminRouter);
router.use("/xauusd", xauusdRouter);
router.use("/btcusd", btcusdRouter);

export default router;
