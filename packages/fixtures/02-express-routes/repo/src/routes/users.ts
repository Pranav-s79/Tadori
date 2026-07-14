import { Router } from "express";
import { makeUserController } from "../container.js";

const router = Router();
const controller = makeUserController();

router.get("/users/:id", controller.getUser);

export { router as usersRouter };
