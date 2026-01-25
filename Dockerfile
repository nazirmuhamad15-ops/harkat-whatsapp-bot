FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source files
COPY . .

# Expose port
EXPOSE 3001

# Start the bot
CMD ["npm", "start"]
