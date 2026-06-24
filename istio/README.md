# Nova Launch — Istio Service Mesh
#
# Apply order:
#   1. namespace.yaml          — create namespace + enable sidecar injection
#   2. deployments.yaml        — workloads (backend, frontend, gateway)
#   3. services.yaml           — ClusterIP services
#   4. gateway.yaml            — Istio IngressGateway
#   5. virtual-services.yaml   — routing rules
#   6. destination-rules.yaml  — traffic policies (mTLS, circuit breaker)
#   7. peer-authentication.yaml — enforce STRICT mTLS mesh-wide
#
# Quick start:
#   kubectl apply -f istio/
#
# Prerequisites:
#   - Kubernetes 1.27+
#   - Istio 1.20+ installed (istioctl install --set profile=default)
#   - Secrets created (see README section below)
#
# Secrets required before applying:
#   kubectl create secret generic nova-launch-secrets \
#     --from-literal=DATABASE_URL='postgresql://...' \
#     --from-literal=JWT_SECRET='...' \
#     --from-literal=ADMIN_JWT_SECRET='...' \
#     -n nova-launch
