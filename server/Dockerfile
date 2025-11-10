# Use an official lightweight Node image
FROM node:18-alpine

# Set working directory
WORKDIR /usr/src/app

# Install dependencies first (leverage docker cache)
COPY package*.json ./

# If you prefer npm ci in CI-built images, swap the command below
RUN npm install --production

# Copy app source
COPY . .

# Build-time arguments
ARG VERSION
ARG COMMIT_SHA

# Expose the version as environment variables inside the image
ENV VERSION=${VERSION}
ENV COMMIT_SHA=${COMMIT_SHA}

# Set default port (matches config default)
ENV PORT=4000

# Expose port
EXPOSE 4000

# Labels following OCI and common conventions
LABEL org.opencontainers.image.title="creative-foraging-server"
LABEL org.opencontainers.image.version="$VERSION"
LABEL org.opencontainers.image.revision="$COMMIT_SHA"

# Start the server
CMD ["node", "src/server.js"]
