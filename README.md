# OpenClaw Hetzner Deployment

Deploy OpenClaw to Hetzner Cloud using Pulumi with Tailscale for secure access.

## Architecture

| Component | Port | Purpose |
|-----------|------|---------|
| Gateway | 18789 | WebSocket server for messaging |
| Browser control | 18791 | Headless Chrome for web automation |
| Docker sandbox | — | Isolated container environment |

Server: **cax21** (ARM64, 4 vCPUs, 8GB RAM, ~€6.49/month)

## Prerequisites

### Local Tools

**Node.js 18+:**
```bash
# Check if installed
node --version

# Install via nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc  # or restart terminal
nvm install 22
```

**Pulumi CLI:**
```bash
# macOS
brew install pulumi/tap/pulumi

# Verify
pulumi version
```

## Credential Setup

Copy the example file and fill in your credentials:
```bash
cp .env.example .env
```

### 1. Hetzner Cloud API Token

1. Go to https://console.hetzner.cloud/
2. Sign up or log in
3. Click **"+ New project"** (or use existing project)
4. Name it something like "openclaw"
5. Enter the project
6. In left sidebar, click **Security** → **API Tokens**
7. Click **"Generate API Token"**
8. Name: `pulumi-openclaw`
9. Permissions: **Read & Write**
10. Click **Generate API token**
11. **Copy and save the token immediately** (shown only once!)

→ Save as `HCLOUD_TOKEN` in your `.env` file

### 2. Anthropic API Key

1. Go to https://console.anthropic.com/
2. Sign up or log in
3. Click your profile (top right) → **API Keys**
4. Click **"Create Key"**
5. Name: `openclaw-hetzner`
6. Click **Create Key**
7. **Copy and save the key immediately**

Note: You'll need billing set up and credits in your Anthropic account.

→ Save as `ANTHROPIC_API_KEY` in your `.env` file

### 3. Tailscale Setup

**Part A: Create Account & Install**
1. Go to https://tailscale.com/ and sign up
2. Install Tailscale on your local machine:
   - macOS: `brew install tailscale` or download from https://tailscale.com/download
   - Connect your local machine to your tailnet

**Part B: Enable HTTPS (Required for OpenClaw)**
1. Go to https://login.tailscale.com/admin/dns
2. Scroll to **HTTPS Certificates**
3. Click **"Enable HTTPS..."**
4. This enables `*.ts.net` certificates for your tailnet

**Part C: Note Your Tailnet DNS Name**
1. On the same DNS page, find **"Tailnet name"**
2. It looks like: `tail1a2b3.ts.net` or `your-email.gmail.com.beta.tailscale.net`

→ Save as `TAILNET_DNS_NAME` in your `.env` file

**Part D: Generate Auth Key**
1. Go to https://login.tailscale.com/admin/settings/keys
2. Click **"Generate auth key..."**
3. Settings:
   - Description: `openclaw-hetzner`
   - Reusable: ✅ Yes (recommended for testing/redeployment)
   - Ephemeral: ❌ No
   - Tags: leave empty
   - Expiration: 90 days (or your preference)
4. Click **Generate key**
5. **Copy the key immediately** (starts with `tskey-auth-...`)

→ Save as `TAILSCALE_AUTH_KEY` in your `.env` file

### Credential Checklist

After setup, verify your `.env` file has:
- [ ] `HCLOUD_TOKEN` - Hetzner API token
- [ ] `ANTHROPIC_API_KEY` - Starts with `sk-ant-...`
- [ ] `TAILSCALE_AUTH_KEY` - Starts with `tskey-auth-...`
- [ ] `TAILNET_DNS_NAME` - Like `tail1234.ts.net`

## Deployment

```bash
# Initialize local Pulumi backend (no account needed)
pulumi login --local

# Install dependencies
npm install

# Initialize stack
pulumi stack init dev

# Deploy (automatically loads .env)
npm run deploy
```

## Complete Setup

After deployment, wait 3-5 minutes for cloud-init to complete, then run onboarding:

```bash
# SSH into the server via Tailscale
ssh ubuntu@<server-name>

# Or via public IP (get IP with: dotenv -- pulumi stack output ipv4Address)
ssh -i /tmp/openclaw-key.pem root@<ip-address>
su - ubuntu

# Run interactive onboarding
openclaw onboard --install-daemon
```

Follow the prompts to configure authentication, channels (WhatsApp, Telegram, etc.), and skills.

After onboarding, verify the setup:
```bash
openclaw doctor
openclaw status
openclaw health
```

## Access OpenClaw

```bash
# Get the URL with authentication token
npm run output
```

Open that URL in your browser.

## SSH Access

**Via Tailscale (recommended):**
```bash
ssh ubuntu@openclaw-hetzner
```

**Via public IP (fallback):**
```bash
pulumi stack output privateKeyPem --show-secrets > /tmp/openclaw-key.pem
chmod 600 /tmp/openclaw-key.pem
ssh -i /tmp/openclaw-key.pem root@$(pulumi stack output serverIp)
```

## Verify Service

```bash
ssh ubuntu@openclaw-hetzner
systemctl --user status openclaw-gateway
journalctl --user -u openclaw-gateway -f
```

## Costs

~€6.49/month (~$7 USD) for cax21 (ARM64, 4 vCPUs, 8GB RAM)

## Cleanup

```bash
npm run destroy
```

## Security Notes

- All secrets are encrypted in Pulumi state
- Tailscale provides zero-trust networking (no public ports for OpenClaw)
- SSH port 22 is open as fallback only
- Gateway uses token authentication
