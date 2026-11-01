import { z } from "zod";

export const FURNITURE = {
  bench: { name: "木头长椅", category: "休息", color: "#b77c52" },
  flowers: { name: "小花圃", category: "绿植", color: "#d9829c" },
  tree: { name: "圆圆果树", category: "绿植", color: "#71a181" },
  lamp: { name: "庭院路灯", category: "灯光", color: "#e7bb68" },
  pond: { name: "一方小池", category: "风景", color: "#79b9c6" },
  bed: { name: "软软宠物窝", category: "休息", color: "#aaa0cb" },
  picnic: { name: "野餐时光", category: "生活", color: "#d38b68" },
  sign: { name: "欢迎木牌", category: "生活", color: "#bb936c" },
} as const;
export type FurnitureKind = keyof typeof FURNITURE;
export const furnitureSchema = z.object({
  id: z.string().min(1).max(50), kind: z.enum(["bench", "flowers", "tree", "lamp", "pond", "bed", "picnic", "sign"]),
  x: z.number().int().min(0).max(9), y: z.number().int().min(0).max(5), flipped: z.boolean(),
});
export type HomeFurniture = z.infer<typeof furnitureSchema>;
export const petSchema = z.object({ name: z.string().trim().min(1).max(16), kind: z.enum(["cat", "bunny", "dog"]) });
export type HomePet = z.infer<typeof petSchema>;
export const homeSaveSchema = z.object({
  revision: z.number().int().min(0), title: z.string().trim().min(1).max(30),
  welcome: z.string().trim().max(100), theme: z.enum(["meadow", "sunset", "moonlight"]),
  visibility: z.enum(["team", "private"]), pet: petSchema,
  furniture: z.array(furnitureSchema).max(24),
}).superRefine((value, context) => {
  if (new Set(value.furniture.map(item => item.id)).size !== value.furniture.length)
    context.addIssue({ code: "custom", message: "家具编号重复", path: ["furniture"] });
  if (new Set(value.furniture.map(item => `${item.x}:${item.y}`)).size !== value.furniture.length)
    context.addIssue({ code: "custom", message: "两件家具不能放在同一个位置", path: ["furniture"] });
});
export type HomeSettings = z.infer<typeof homeSaveSchema>;
export type HomeProfile = HomeSettings & { ownerId: string; petTeamId: string | null };
export type HomeResident = { ownerId: string; ownerName: string; pet: HomePet };
export type HomeView = {
  actorId: string; view: "mine" | "members" | "courtyard"; home: HomeProfile;
  ownerName: string; teams: { id: string; name: string }[]; teamId: string | null;
  members: { id: string; name: string; title: string; visitable: boolean; pet: HomePet | null }[];
  residents: HomeResident[]; ownPet: HomePet; ownPetTeamId: string | null;
};
export const STARTER_FURNITURE: HomeFurniture[] = [
  { id: "welcome", kind: "sign", x: 2, y: 1, flipped: false },
  { id: "flowers", kind: "flowers", x: 7, y: 2, flipped: false },
  { id: "bench", kind: "bench", x: 1, y: 3, flipped: false },
  { id: "bed", kind: "bed", x: 7, y: 4, flipped: false },
];
