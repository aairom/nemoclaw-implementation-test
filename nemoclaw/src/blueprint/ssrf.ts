// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * nemoclaw/src/blueprint/ssrf.ts
 * SSRF (Server-Side Request Forgery) endpoint validation.
 * Validates hosts/IPs before allowing them as egress targets.
 * Blocks private networks, loopback, metadata endpoints, and link-local ranges.
 */

import type { SsrfValidationResult } from '../types.js';

// ─── Private IP ranges (CIDR-like checks) ────────────────────────────────────

/** Blocked IPv4 patterns (loopback, private, link-local, cloud metadata) */
const BLOCKED_IPV4_PATTERNS: RegExp[] = [
  /^127\./,              // Loopback
  /^10\./,               // RFC 1918 Class A
  /^172\.(1[6-9]|2[0-9]|3[01])\./,  // RFC 1918 Class B
  /^192\.168\./,         // RFC 1918 Class C
  /^169\.254\./,         // Link-local / AWS IMDSv1
  /^0\.0\.0\.0$/,        // Unspecified
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./,  // CGNAT (RFC 6598)
  /^198\.18\./,          // Benchmark testing (RFC 2544)
  /^198\.19\./,
  /^240\./,              // Reserved
];

/** Blocked IPv6 patterns */
const BLOCKED_IPV6_PATTERNS: RegExp[] = [
  /^::1$/,               // Loopback
  /^fe80:/i,             // Link-local
  /^fc00:/i,             // ULA
  /^fd[0-9a-f]{2}:/i,   // ULA
  /^::$/,                // Unspecified
];

/** Blocked hostnames */
const BLOCKED_HOSTNAMES: RegExp[] = [
  /^localhost$/i,
  /^metadata\.google\.internal$/i,
  /\.internal$/i,
  /\.local$/i,
  /^instance-data$/i,
];

// ─── Validator ────────────────────────────────────────────────────────────────

/**
 * Validate that an endpoint is safe to use as an egress target.
 * This is the client-side (host) check. The TypeScript plugin performs
 * additional DNS-level validation inside the sandbox.
 *
 * @param host - Hostname or IP address to validate
 * @returns SsrfValidationResult
 */
export function validateEndpoint(host: string): SsrfValidationResult {
  const trimmed = host.trim().toLowerCase();

  if (!trimmed) {
    return { safe: false, reason: 'Empty host', host };
  }

  // Check blocked hostnames
  for (const pattern of BLOCKED_HOSTNAMES) {
    if (pattern.test(trimmed)) {
      return {
        safe: false,
        reason: `Host '${host}' matches blocked hostname pattern: ${pattern}`,
        host,
      };
    }
  }

  // Check IPv4
  if (isIPv4(trimmed)) {
    for (const pattern of BLOCKED_IPV4_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          safe: false,
          reason: `IPv4 address '${host}' is in a blocked range (private/loopback/metadata)`,
          host,
          resolvedIp: trimmed,
        };
      }
    }
    return { safe: true, host, resolvedIp: trimmed };
  }

  // Check IPv6
  if (isIPv6(trimmed)) {
    for (const pattern of BLOCKED_IPV6_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          safe: false,
          reason: `IPv6 address '${host}' is in a blocked range`,
          host,
          resolvedIp: trimmed,
        };
      }
    }
    return { safe: true, host, resolvedIp: trimmed };
  }

  // Hostname (not an IP) - allow it; DNS resolution happens at runtime
  // The OpenShell L7 proxy will enforce policy at egress
  return { safe: true, host };
}

/**
 * Validate a list of endpoints and return any that are unsafe.
 * @param hosts - Array of hostnames/IPs
 * @returns Array of unsafe results
 */
export function validateEndpoints(hosts: string[]): SsrfValidationResult[] {
  return hosts
    .map((h) => validateEndpoint(h))
    .filter((r) => !r.safe);
}

// ─── IP detection helpers ─────────────────────────────────────────────────────

export function isIPv4(host: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
}

export function isIPv6(host: string): boolean {
  return host.includes(':');
}
