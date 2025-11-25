FROM node:18-slim

# Install Python, pip, and system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install pipx (using --break-system-packages for containerized environment)
RUN python3 -m pip install --user --break-system-packages pipx
RUN python3 -m pipx ensurepath

# Add pipx to PATH
ENV PATH="/root/.local/bin:${PATH}"

# Install gamdl via pipx
RUN pipx install gamdl

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy app source
COPY . .

# Create directories for downloads and temp files
RUN mkdir -p /app/downloads /app/temp

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]