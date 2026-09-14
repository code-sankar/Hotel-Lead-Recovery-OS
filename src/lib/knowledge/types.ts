import type { HotelPolicyType } from '@/types/domain';

/**
 * The trusted view of a hotel that the AI is allowed to speak from.
 * Everything here comes from application-controlled tables; nothing in it is
 * model-generated. If a fact is not in this snapshot, the AI must not state it.
 */
export interface HotelKnowledge {
  business: {
    id: string;
    name: string;
    address: string | null;
    city: string | null;
    state: string | null;
    phone: string | null;
    website: string | null;
    currency: string;
    timezone: string;
  };
  profile: {
    description: string | null;
    locationNote: string | null;
    checkInTime: string | null;
    checkOutTime: string | null;
    amenities: string[];
    businessHours: Record<string, unknown>;
    landmarks: string | null;
  };
  rooms: KnowledgeRoom[];
  policies: KnowledgePolicy[];
  faqs: KnowledgeFaq[];
  settings: {
    aiTone: string;
    aiWelcomeMessage: string | null;
    aiEscalationMessage: string;
  };
}

export interface KnowledgeRoom {
  id: string;
  name: string;
  description: string | null;
  basePrice: number;
  maxGuests: number;
  amenities: string[];
  breakfastIncluded: boolean;
  notes: string | null;
  /** Physical rooms of this type; the baseline for availability. */
  totalUnits: number;
}

export interface KnowledgePolicy {
  type: HotelPolicyType;
  title: string | null;
  content: string;
}

export interface KnowledgeFaq {
  question: string;
  answer: string;
}
