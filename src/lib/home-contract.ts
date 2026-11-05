import { z } from "zod";
import { homePetIdSchema, type HomePetDefinition } from "./pets/home-pet-contract";

export const FURNITURE = {
  bench: { name: "休息座椅", category: "休息", color: "#597b7b" },
  flowers: { name: "模块花坛", category: "绿植", color: "#82ab99" },
  tree: { name: "庭院绿植", category: "绿植", color: "#579785" },
  lamp: { name: "庭院路灯", category: "灯光", color: "#e7bb68" },
  pond: { name: "景观水池", category: "风景", color: "#79b9c6" },
  bed: { name: "桌宠休息区", category: "休息", color: "#869fae" },
  picnic: { name: "会客桌", category: "生活", color: "#7c929b" },
  sign: { name: "空间标识", category: "生活", color: "#597b7b" },
} as const;
export type FurnitureKind = keyof typeof FURNITURE;
export const furnitureSchema = z.object({
  id: z.string().min(1).max(50), kind: z.enum(["bench", "flowers", "tree", "lamp", "pond", "bed", "picnic", "sign"]),
  x: z.number().int().min(0).max(9), y: z.number().int().min(0).max(5), flipped: z.boolean(),
});
export type HomeFurniture = z.infer<typeof furnitureSchema>;
// Legacy kinds remain readable; only the provider supplies a pet's appearance.
export const petSchema = z.object({ name: z.string().trim().min(1).max(40), kind: z.enum(["cat", "bunny", "dog", "placeholder"]), petId: homePetIdSchema.nullable().optional() });
export type HomePet = z.infer<typeof petSchema>;
export type HomePetDisplay = HomePet & { definition: HomePetDefinition | null; status: "unbound" | "ready" | "unavailable" };
export const DEFAULT_HOME_PET: HomePet = { name: "我的桌宠", kind: "placeholder", petId: null };
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
export type HomeResident = { ownerId: string; ownerName: string; pet: HomePetDisplay };
export type HomeView = {
  actorId: string; view: "mine" | "members" | "courtyard"; home: HomeProfile;
  ownerName: string; teams: { id: string; name: string }[]; teamId: string | null;
  members: { id: string; name: string; title: string; visitable: boolean; pet: HomePetDisplay | null }[];
  residents: HomeResident[]; ownPet: HomePetDisplay; ownPetTeamId: string | null;
  availablePets: HomePetDefinition[];
  ownWorkingTeamId: string | null;
  workstations: { ownerId: string; ownerName: string; working: boolean; pet: HomePetDisplay | null }[];
};
export const STARTER_FURNITURE: HomeFurniture[] = [
  { id: "welcome", kind: "sign", x: 2, y: 1, flipped: false },
  { id: "flowers", kind: "flowers", x: 7, y: 2, flipped: false },
  { id: "bench", kind: "bench", x: 1, y: 3, flipped: false },
  { id: "bed", kind: "bed", x: 7, y: 4, flipped: false },
];
