import type { HotelPolicyType } from '@/types/domain';

/**
 * Demo hotel definition — the single source of truth for the seed script and
 * the test fixtures. Entirely fictional: no real guest data is used anywhere.
 */

export const DEMO_HOTEL = {
  name: 'Riverfront Residency',
  address: 'Mancotta Road, Dibrugarh, Assam 786001',
  city: 'Dibrugarh',
  state: 'Assam',
  country: 'India',
  phone: '+913732300100',
  website: 'https://riverfrontresidency.example',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  description:
    'A 24-room riverside property in Dibrugarh, 15 minutes from the town centre, popular with tea-garden visitors and business travellers.',
  locationNote: 'On Mancotta Road, a short drive from the Brahmaputra ghat and the railway station.',
  landmarks: 'Dibrugarh Airport is about 40 minutes away; the railway station is 4 km.',
  checkInTime: '12:00 PM',
  checkOutTime: '11:00 AM',
  amenities: [
    'free Wi-Fi',
    'free parking',
    'in-house restaurant',
    'air conditioning',
    '24-hour hot water',
    'power backup',
    'airport transfer on request',
    'laundry service',
  ],
  businessHours: {
    reception: '24 hours',
    restaurant: '7:00 AM – 10:30 PM',
    front_office: '7:00 AM – 11:00 PM',
  },
} as const;

export interface DemoRoom {
  name: string;
  description: string;
  basePrice: number;
  maxGuests: number;
  amenities: string[];
  breakfastIncluded: boolean;
  notes: string | null;
  sortOrder: number;
}

export const DEMO_ROOMS: DemoRoom[] = [
  {
    name: 'Deluxe Room',
    description: 'Queen bed, garden-facing, 220 sq ft with a work desk and tea/coffee maker.',
    basePrice: 2800,
    maxGuests: 2,
    amenities: ['air conditioning', 'free Wi-Fi', 'TV', 'attached bathroom', 'tea/coffee maker'],
    breakfastIncluded: true,
    notes: 'Extra bed available on request at an additional charge.',
    sortOrder: 1,
  },
  {
    name: 'Executive Room',
    description: 'King bed, river-facing, 300 sq ft with a seating area and mini fridge.',
    basePrice: 3500,
    maxGuests: 3,
    amenities: [
      'air conditioning',
      'free Wi-Fi',
      'TV',
      'mini fridge',
      'river view',
      'work desk',
    ],
    breakfastIncluded: true,
    notes: 'Preferred by business travellers; early check-in subject to availability.',
    sortOrder: 2,
  },
  {
    name: 'Suite',
    description: 'Separate living room and bedroom, 480 sq ft, river-facing with a dining table.',
    basePrice: 5500,
    maxGuests: 4,
    amenities: [
      'air conditioning',
      'free Wi-Fi',
      'living room',
      'mini fridge',
      'river view',
      'bathtub',
    ],
    breakfastIncluded: true,
    notes: 'Suitable for families; one extra bed can be added.',
    sortOrder: 3,
  },
];

export interface DemoPolicy {
  type: HotelPolicyType;
  title: string;
  content: string;
}

export const DEMO_POLICIES: DemoPolicy[] = [
  {
    type: 'cancellation',
    title: 'Cancellation policy',
    content:
      'Free cancellation up to 48 hours before check-in. Cancellations within 48 hours are charged one night. No-shows are charged the full stay.',
  },
  {
    type: 'check_in',
    title: 'Check-in policy',
    content:
      'Check-in is from 12:00 PM. A government photo ID is required for every adult guest. Early check-in is subject to availability on the day.',
  },
  {
    type: 'check_out',
    title: 'Check-out policy',
    content: 'Check-out is by 11:00 AM. Late check-out until 2:00 PM is charged at half a day.',
  },
  {
    type: 'child',
    title: 'Child policy',
    content:
      'Children under 6 stay free using existing bedding. Children 6 and above are charged as an extra person.',
  },
  {
    type: 'extra_bed',
    title: 'Extra bed policy',
    content: 'One extra bed can be added in Deluxe, Executive and Suite rooms for 800 per night.',
  },
  {
    type: 'pet',
    title: 'Pet policy',
    content: 'Pets are not allowed at the property.',
  },
  {
    type: 'payment',
    title: 'Payment policy',
    content:
      'We accept UPI, cash and all major cards at the reception. Advance payment is required only for group bookings of four rooms or more.',
  },
];

export interface DemoFaq {
  question: string;
  answer: string;
  sortOrder: number;
}

export const DEMO_FAQS: DemoFaq[] = [
  {
    question: 'Is parking available?',
    answer: 'Yes, we have free on-site parking for guests, including space for larger vehicles.',
    sortOrder: 1,
  },
  {
    question: 'Is breakfast included?',
    answer: 'Yes, breakfast is included with all our room types and is served from 7:30 AM to 10:00 AM.',
    sortOrder: 2,
  },
  {
    question: 'Is Wi-Fi free?',
    answer: 'Yes, Wi-Fi is free throughout the property.',
    sortOrder: 3,
  },
  {
    question: 'Is early check-in available?',
    answer:
      'Early check-in depends on how the previous night went, so our front desk confirms it on the morning of arrival.',
    sortOrder: 4,
  },
  {
    question: 'Is airport pickup available?',
    answer:
      'Yes, we arrange airport transfers on request. Please share your flight details and the front desk will confirm the charge.',
    sortOrder: 5,
  },
  {
    question: 'Do you have a restaurant?',
    answer:
      'Yes, our in-house restaurant serves Assamese and North Indian food from 7:00 AM to 10:30 PM.',
    sortOrder: 6,
  },
];

export const DEMO_WELCOME_MESSAGE =
  'Hello! Thanks for writing to Riverfront Residency. I can help with room options, rates and directions — what dates are you looking at?';

export const DEMO_ESCALATION_MESSAGE =
  'Let me get someone from our team to help you with this. They will reply here shortly.';
