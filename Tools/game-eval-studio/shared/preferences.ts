import { z } from 'zod';

export const preferencesSchema = z.object({
  engine: z.string().trim().min(1).max(100),
  engineVersion: z.string().trim().min(1).max(100),
  platform: z.string().trim().min(1).max(100),
  difficulty: z.enum(['基础', '进阶', '专家']),
  timeBudget: z.number().int().min(1).max(10080),
  passThreshold: z.number().min(0).max(100),
}).strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences: Preferences = {
  engine: 'Unity', engineVersion: '6000.5.5f1', platform: 'Windows',
  difficulty: '进阶', timeBudget: 120, passThreshold: 75,
};
