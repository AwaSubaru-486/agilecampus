import { z } from "zod";

/** Stable contract: pet creation, uploads and ownership belong to the custom-pet module. */
export const HOME_PET_CONTRACT_VERSION = 1 as const;
export const homePetIdSchema = z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9_:.\-]+$/);
const assetPath = z.string().max(1024).refine(value => {
  let path: string;
  try { path = decodeURIComponent(value); } catch { return false; }
  return /^\/(?:pets|api\/pets)\//.test(path) && !/[\\\s?#%]/.test(path) && !path.split("/").includes("..");
},
"桌宠资源应使用本站 /pets/ 或 /api/pets/ 下的地址");
const dimension = z.number().int().min(1).max(4096);
const animation = z.object({ start: z.number().int().min(0), count: z.number().int().min(1).max(256), fps: z.number().min(0).max(30) });
export const homePetAppearanceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("image"), src: assetPath, width: dimension, height: dimension }),
  z.object({ type: z.literal("spritesheet"), src: assetPath, frameWidth: dimension, frameHeight: dimension,
    columns: z.number().int().min(1).max(32), rows: z.number().int().min(1).max(32),
    idle: animation, greet: animation.optional(),
  }),
]).superRefine((appearance, context) => {
  if (appearance.type !== "spritesheet") return;
  for (const action of [appearance.idle, appearance.greet]) {
    if (action && action.start + action.count > appearance.columns * appearance.rows)
      context.addIssue({ code: "custom", message: "桌宠动画超出精灵图帧数" });
  }
});
export const homePetDefinitionSchema = z.object({
  id: homePetIdSchema, ownerId: z.uuid(), name: z.string().trim().min(1).max(40), appearance: homePetAppearanceSchema,
});
export type HomePetDefinition = z.infer<typeof homePetDefinitionSchema>;
export type HomePetAppearance = z.infer<typeof homePetAppearanceSchema>;
export type HomePetAction = "idle" | "greet";
export type HomePetProvider = {
  listOwned: (ownerId: string) => Promise<HomePetDefinition[]>;
  getOwned: (ownerId: string, petId: string) => Promise<HomePetDefinition | null>;
};
