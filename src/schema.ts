import { pgTable, text, integer, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Simple ID generator
function createId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// USERS
export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  email: text('email').notNull().unique(),
  name: text('name'),
  password: text('password'),
  role: text('role').notNull().default('CUSTOMER'),
  phone: text('phone'),
  avatar: text('avatar'),
  isActive: boolean('is_active').default(true),
  emailVerified: boolean('email_verified').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  phoneIdx: index('users_phone_idx').on(table.phone),
}));

// CONVERSATIONS
export const conversations = pgTable('conversations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').references(() => users.id),
  status: text('status').default('ai_active'),
  lastMessageAt: timestamp('last_message_at').defaultNow(),
  unreadCount: integer('unread_count').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// MESSAGES
export const messages = pgTable('messages', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
  sender: text('sender').notNull(),
  type: text('type').default('text'),
  content: text('content'),
  mediaUrl: text('media_url'),
  status: text('status').default('SENT'),
  messageId: text('message_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ORDERS (minimal for status checking)
export const orders = pgTable('orders', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orderNumber: text('order_number').notNull().unique(),
  userId: text('user_id').references(() => users.id),
  customerName: text('customer_name').notNull(),
  customerPhone: text('customer_phone').notNull(),
  status: text('status').default('PENDING'),
  total: text('total'),
  trackingNumber: text('tracking_number'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  statusIdx: index('orders_status_idx').on(table.status),
  trackingNumberIdx: index('orders_tracking_number_idx').on(table.trackingNumber),
}));

// RELATIONS
export const usersRelations = relations(users, ({ many }) => ({
  conversations: many(conversations),
  orders: many(orders),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, {
    fields: [conversations.userId],
    references: [users.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  user: one(users, {
    fields: [orders.userId],
    references: [users.id],
  }),
}));
