import { z } from 'zod';
import { HOTEL_POLICY_TYPES, LEAD_INTENTS } from '@/types/domain';

/**
 * Input validation. Every server action and route handler parses its input
 * through one of these before touching the database.
 */

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address.');

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(72, 'Passwords can be at most 72 characters.');

export const signUpSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name.').max(120),
  email: emailSchema,
  password: passwordSchema,
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
});

export const resetRequestSchema = z.object({ email: emailSchema });

export const updatePasswordSchema = z.object({ password: passwordSchema });

export const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name.').max(120),
  phone: z.string().trim().max(32).optional().or(z.literal('')),
});

export const createBusinessSchema = z.object({
  name: z.string().trim().min(2, 'Enter the hotel name.').max(160),
  timezone: z.string().trim().min(1).default('Asia/Kolkata'),
  currency: z.string().trim().length(3).default('INR'),
});

export const businessGeneralSchema = z.object({
  name: z.string().trim().min(2).max(160),
  address: z.string().trim().max(400).optional().or(z.literal('')),
  city: z.string().trim().max(120).optional().or(z.literal('')),
  state: z.string().trim().max(120).optional().or(z.literal('')),
  phone: z.string().trim().max(32).optional().or(z.literal('')),
  website: z.string().trim().url('Enter a valid URL.').optional().or(z.literal('')),
  timezone: z.string().trim().min(1),
  currency: z.string().trim().length(3),
});

export const hotelProfileSchema = z.object({
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  locationNote: z.string().trim().max(600).optional().or(z.literal('')),
  landmarks: z.string().trim().max(600).optional().or(z.literal('')),
  checkInTime: z.string().trim().max(40).optional().or(z.literal('')),
  checkOutTime: z.string().trim().max(40).optional().or(z.literal('')),
  amenities: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
  receptionHours: z.string().trim().max(120).optional().or(z.literal('')),
  restaurantHours: z.string().trim().max(120).optional().or(z.literal('')),
});

export const roomSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, 'Enter a room name.').max(120),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  basePrice: z.coerce.number().min(0, 'Price cannot be negative.').max(10_000_000),
  maxGuests: z.coerce.number().int().min(1).max(30),
  amenities: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  breakfastIncluded: z.boolean().default(false),
  notes: z.string().trim().max(600).optional().or(z.literal('')),
  active: z.boolean().default(true),
});

export const policySchema = z.object({
  id: z.string().uuid().optional(),
  type: z.enum(HOTEL_POLICY_TYPES as unknown as [string, ...string[]]),
  title: z.string().trim().max(120).optional().or(z.literal('')),
  content: z.string().trim().min(3, 'Write the policy text.').max(2000),
  active: z.boolean().default(true),
});

export const faqSchema = z.object({
  id: z.string().uuid().optional(),
  question: z.string().trim().min(3, 'Write the question.').max(300),
  answer: z.string().trim().min(3, 'Write the answer.').max(2000),
  active: z.boolean().default(true),
});

export const aiSettingsSchema = z.object({
  aiEnabled: z.boolean(),
  aiTone: z.enum(['friendly_professional', 'warm_casual', 'formal']),
  aiWelcomeMessage: z.string().trim().max(600).optional().or(z.literal('')),
  aiEscalationMessage: z.string().trim().min(5).max(600),
});

export const followUpSettingsSchema = z.object({
  followUpsEnabled: z.boolean(),
  maxFollowUps: z.coerce.number().int().min(0).max(5),
  quietHoursStart: z.coerce.number().int().min(0).max(23).nullable(),
  quietHoursEnd: z.coerce.number().int().min(0).max(23).nullable(),
});

export const followUpRuleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  delayMinutes: z.coerce.number().int().min(15, 'Wait at least 15 minutes.').max(60 * 24 * 30),
  messageTemplate: z.string().trim().min(5).max(900),
  active: z.boolean(),
});

export const whatsappSettingsSchema = z.object({
  phoneNumberId: z.string().trim().max(64).optional().or(z.literal('')),
  displayPhoneNumber: z.string().trim().max(32).optional().or(z.literal('')),
  wabaId: z.string().trim().max(64).optional().or(z.literal('')),
  accessToken: z.string().trim().max(600).optional().or(z.literal('')),
  appSecret: z.string().trim().max(200).optional().or(z.literal('')),
  verifyToken: z.string().trim().max(200).optional().or(z.literal('')),
  messagingMode: z.enum(['demo', 'live']),
});

export const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  text: z.string().trim().min(1, 'Write a message.').max(4000),
});

export const conversationModeSchema = z.object({
  conversationId: z.string().uuid(),
  mode: z.enum(['ai', 'human', 'paused']),
});

export const convertLeadSchema = z.object({
  leadId: z.string().uuid(),
  conversionValue: z.coerce.number().min(0).max(100_000_000),
});

export const loseLeadSchema = z.object({
  leadId: z.string().uuid(),
  reason: z.string().trim().max(300).optional().or(z.literal('')),
});

export const updateLeadSchema = z.object({
  leadId: z.string().uuid(),
  estimatedValue: z.coerce.number().min(0).max(100_000_000).nullable().optional(),
  expectedCheckIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  expectedCheckOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  guests: z.coerce.number().int().min(1).max(50).nullable().optional(),
  roomPreference: z.string().trim().max(120).nullable().optional(),
  intent: z.enum(LEAD_INTENTS as unknown as [string, ...string[]]).optional(),
});

export const assignLeadSchema = z.object({
  leadId: z.string().uuid(),
  staffId: z.string().uuid().nullable(),
});

export const noteSchema = z.object({
  leadId: z.string().uuid(),
  body: z.string().trim().min(1, 'Write a note.').max(2000),
});

export const manualFollowUpSchema = z.object({
  leadId: z.string().uuid(),
  scheduledFor: z.string().datetime({ offset: true }),
  body: z.string().trim().min(3).max(900),
});

export const simulateInboundSchema = z.object({
  businessId: z.string().uuid(),
  phoneNumber: z.string().trim().regex(/^\d{8,15}$/, 'Use digits only, including country code.'),
  name: z.string().trim().max(120).optional(),
  text: z.string().trim().min(1).max(2000),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type RoomInput = z.infer<typeof roomSchema>;
export type PolicyInput = z.infer<typeof policySchema>;
export type FaqInput = z.infer<typeof faqSchema>;
