import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminRouter from "./admin";
import { xauusdRouter } from "./xauusd";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/admin", adminRouter);
router.use("/xauusd", xauusdRouter);

export default router;
