import type { HotelKnowledge, KnowledgeRoom } from './types';

export function formatMoney(amount: number, currency = 'INR'): string {
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(amount)}`;
}

export function describeRoom(room: KnowledgeRoom, currency: string): string {
  const parts = [
    `${room.name} — ${formatMoney(room.basePrice, currency)} per night`,
    `sleeps up to ${room.maxGuests}`,
  ];
  if (room.breakfastIncluded) parts.push('breakfast included');
  if (room.amenities.length) parts.push(room.amenities.slice(0, 4).join(', '));
  return parts.join(', ');
}

/**
 * Renders the knowledge snapshot as the factual context block handed to the
 * model. Kept compact and explicit so the model has no reason to guess.
 */
export function formatKnowledgeForPrompt(knowledge: HotelKnowledge): string {
  const { business, profile, rooms, policies, faqs } = knowledge;
  const lines: string[] = [];

  lines.push('## HOTEL');
  lines.push(`Name: ${business.name}`);
  if (business.address) lines.push(`Address: ${business.address}`);
  if (business.city) lines.push(`City: ${[business.city, business.state].filter(Boolean).join(', ')}`);
  if (business.phone) lines.push(`Reception phone: ${business.phone}`);
  if (profile.description) lines.push(`About: ${profile.description}`);
  if (profile.locationNote) lines.push(`Location notes: ${profile.locationNote}`);
  if (profile.landmarks) lines.push(`Nearby: ${profile.landmarks}`);
  if (profile.checkInTime) lines.push(`Check-in time: ${profile.checkInTime}`);
  if (profile.checkOutTime) lines.push(`Check-out time: ${profile.checkOutTime}`);
  if (profile.amenities.length) lines.push(`Hotel amenities: ${profile.amenities.join(', ')}`);

  lines.push('');
  lines.push('## ROOM TYPES (the only rooms and the only prices you may quote)');
  if (rooms.length === 0) {
    lines.push('No room types configured. You must not quote any price or room name.');
  } else {
    for (const room of rooms) {
      lines.push(`- ${describeRoom(room, business.currency)} (${room.totalUnits} in total)`);
      if (room.description) lines.push(`  Description: ${room.description}`);
      if (room.notes) lines.push(`  Notes: ${room.notes}`);
    }
  }

  lines.push('');
  lines.push('## POLICIES (quote only what is written here)');
  if (policies.length === 0) {
    lines.push('No policies configured. Say a team member will confirm policy questions.');
  } else {
    for (const policy of policies) {
      lines.push(`- ${policy.title ?? policy.type}: ${policy.content}`);
    }
  }

  if (faqs.length) {
    lines.push('');
    lines.push('## FAQs');
    for (const faq of faqs) lines.push(`- Q: ${faq.question}\n  A: ${faq.answer}`);
  }

  lines.push('');
  lines.push('## INVENTORY');
  lines.push(
    'Room counts above are what the hotel owns in total, not what is free. Whether a room is free on a given date comes only from the AVAILABILITY section, which is verified per enquiry. If that section is missing, you do not know.',
  );

  return lines.join('\n');
}
