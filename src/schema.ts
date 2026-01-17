import { pgTable, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  email: text('email').unique(), // Optional for WA contacts
  name: text('name'),
  role: text('role').notNull().default('CUSTOMER'),
  phone: text('phone').unique(),
  avatar: text('avatar'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const conversations = pgTable('conversations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').references(() => users.id),
  status: text('status').default('ai_active'), // ai_active, human_manual
  lastMessageAt: timestamp('last_message_at').defaultNow(),
  unreadCount: integer('unread_count').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
  sender: text('sender').notNull(), // USER, ADMIN, SYSTEM
  type: text('type').default('text'), // text, image, document, location
  content: text('content'),
  mediaUrl: text('media_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
