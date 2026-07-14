import { Router } from "express";
import { makeAdminController } from "../container.js";

const router = Router();
const controller = makeAdminController();
const adminPath = "/admin";

router.post(adminPath, controller.createAdmin);

export { router as adminRouter };
