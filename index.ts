import * as pulumi from "@pulumi/pulumi";
import * as hcloud from "@pulumi/hcloud";
import * as tls from "@pulumi/tls";

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

const anthropicApiKey = requireEnv("ANTHROPIC_API_KEY");
const tailscaleAuthKey = requireEnv("TAILSCALE_AUTH_KEY");
const tailnetDnsName = requireEnv("TAILNET_DNS_NAME");

const serverType = process.env.SERVER_TYPE ?? "cax21";
const location = process.env.LOCATION ?? "nbg1";
const gatewayPort = parseInt(process.env.GATEWAY_PORT ?? "18789");

const gatewayToken = new tls.PrivateKey("openclaw-gateway-token", {
    algorithm: "ED25519",
}).publicKeyOpenssh.apply(key => {
    const hash = require("crypto").createHash("sha256").update(key).digest("hex");
    return hash.substring(0, 48);
});

const sshKey = new tls.PrivateKey("openclaw-ssh-key", {
    algorithm: "ED25519",
});

const hcloudSshKey = new hcloud.SshKey("openclaw-sshkey", {
    publicKey: sshKey.publicKeyOpenssh,
});

const firewallRules: hcloud.types.input.FirewallRule[] = [
    {
        direction: "out",
        protocol: "tcp",
        port: "any",
        destinationIps: ["0.0.0.0/0", "::/0"],
        description: "Allow all outbound TCP",
    },
    {
        direction: "out",
        protocol: "udp",
        port: "any",
        destinationIps: ["0.0.0.0/0", "::/0"],
        description: "Allow all outbound UDP",
    },
    {
        direction: "out",
        protocol: "icmp",
        destinationIps: ["0.0.0.0/0", "::/0"],
        description: "Allow all outbound ICMP",
    },
    {
        direction: "in",
        protocol: "tcp",
        port: "22",
        sourceIps: ["0.0.0.0/0", "::/0"],
        description: "SSH access (fallback)",
    },
];

const firewall = new hcloud.Firewall("openclaw-firewall", {
    rules: firewallRules,
});

const userData = gatewayToken.apply((gwToken) => {
    return `#!/bin/bash
set -e

export DEBIAN_FRONTEND=noninteractive

# Store secrets in variables (base64 encoded to avoid shell interpretation issues)
ANTHROPIC_KEY_B64="${Buffer.from(anthropicApiKey).toString("base64")}"
TAILSCALE_KEY_B64="${Buffer.from(tailscaleAuthKey).toString("base64")}"
GATEWAY_TOKEN_B64="${Buffer.from(gwToken).toString("base64")}"

# System updates
apt-get update
apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# Create ubuntu user (Hetzner uses root by default)
useradd -m -s /bin/bash -G docker,sudo ubuntu || true

# Enable passwordless sudo for ubuntu
echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu
chmod 440 /etc/sudoers.d/ubuntu

# Copy root's authorized_keys to ubuntu for SSH access
mkdir -p /home/ubuntu/.ssh
cp /root/.ssh/authorized_keys /home/ubuntu/.ssh/
chown -R ubuntu:ubuntu /home/ubuntu/.ssh
chmod 700 /home/ubuntu/.ssh
chmod 600 /home/ubuntu/.ssh/authorized_keys

# Install Node.js 22 via NodeSource (system-wide)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# Install OpenClaw and MCP tools globally
npm install -g openclaw@latest @presto-ai/google-workspace-mcp

# Install Homebrew dependencies
apt-get install -y build-essential procps curl file git

# Prepare Homebrew directory and install as ubuntu user
mkdir -p /home/linuxbrew
chown ubuntu:ubuntu /home/linuxbrew
sudo -u ubuntu bash << 'BREW_SCRIPT'
NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"' >> ~/.bashrc
eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"

# Install common skill dependencies
brew install gh ffmpeg jq ripgrep uv
BREW_SCRIPT

# Decode and set environment variables for ubuntu user
ANTHROPIC_KEY=$(echo "$ANTHROPIC_KEY_B64" | base64 -d)
echo "export ANTHROPIC_API_KEY='$ANTHROPIC_KEY'" >> /home/ubuntu/.bashrc

# Install and configure Tailscale
echo "Installing Tailscale..."
curl -fsSL https://tailscale.com/install.sh | sh
TAILSCALE_KEY=$(echo "$TAILSCALE_KEY_B64" | base64 -d)
tailscale up --authkey="$TAILSCALE_KEY" --ssh || echo "WARNING: Tailscale setup failed. Run 'sudo tailscale up' manually."

# Enable systemd linger for ubuntu user (required for user services to run at boot)
loginctl enable-linger ubuntu

# Start user's systemd instance (required for user services during cloud-init)
systemctl start user@1000.service

# Create openclaw directories
sudo -u ubuntu mkdir -p /home/ubuntu/.openclaw/credentials

# Save environment variables for later use during onboarding
GATEWAY_TOKEN=$(echo "$GATEWAY_TOKEN_B64" | base64 -d)
cat > /home/ubuntu/.openclaw/.env << ENVFILE
ANTHROPIC_API_KEY=$ANTHROPIC_KEY
GATEWAY_TOKEN=$GATEWAY_TOKEN
ENVFILE
chown ubuntu:ubuntu /home/ubuntu/.openclaw/.env
chmod 600 /home/ubuntu/.openclaw/.env

# Enable Tailscale HTTPS proxy (requires HTTPS to be enabled in Tailscale admin console)
echo "Enabling Tailscale HTTPS proxy..."
tailscale serve --bg ${gatewayPort} || echo "WARNING: tailscale serve failed. Enable HTTPS in your Tailscale admin console first."

echo ""
echo "=============================================="
echo "OpenClaw prerequisites installed!"
echo ""
echo "To complete setup, SSH in and run:"
echo "  ssh ubuntu@$(hostname)"
echo "  openclaw onboard --install-daemon"
echo "=============================================="
`;
});

const server = new hcloud.Server("openclaw-server", {
    serverType: serverType,
    location: location,
    image: "ubuntu-24.04",
    sshKeys: [hcloudSshKey.id],
    firewallIds: [firewall.id.apply(id => Number(id))],
    userData: userData,
    labels: {
        purpose: "openclaw",
    },
});

export const ipv4Address = server.ipv4Address;
export const privateKey = pulumi.secret(sshKey.privateKeyOpenssh);
export const tailscaleHostname = server.name;
export const tailscaleUrlWithToken = pulumi.secret(
    pulumi.interpolate`https://${server.name}.${tailnetDnsName}/?token=${gatewayToken}`
);
export const gatewayTokenOutput = pulumi.secret(gatewayToken);
