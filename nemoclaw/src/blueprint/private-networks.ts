// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * nemoclaw/src/blueprint/private-networks.ts
 * Shared private-network block list loader for SSRF and policy validation.
 */

export interface PrivateNetworkRange {
  cidr: string;
  description: string;
}

/** RFC-defined private/reserved ranges that should not be reachable from sandboxes */
export const PRIVATE_NETWORK_RANGES: PrivateNetworkRange[] = [
  { cidr: '10.0.0.0/8', description: 'RFC 1918 - Class A private' },
  { cidr: '172.16.0.0/12', description: 'RFC 1918 - Class B private' },
  { cidr: '192.168.0.0/16', description: 'RFC 1918 - Class C private' },
  { cidr: '127.0.0.0/8', description: 'Loopback' },
  { cidr: '169.254.0.0/16', description: 'Link-local / APIPA / Cloud metadata' },
  { cidr: '100.64.0.0/10', description: 'CGNAT (RFC 6598)' },
  { cidr: '198.18.0.0/15', description: 'Benchmark testing (RFC 2544)' },
  { cidr: '0.0.0.0/8', description: 'Unspecified' },
  { cidr: '240.0.0.0/4', description: 'Reserved (RFC 1112)' },
  { cidr: '::1/128', description: 'IPv6 loopback' },
  { cidr: 'fe80::/10', description: 'IPv6 link-local' },
  { cidr: 'fc00::/7', description: 'IPv6 ULA' },
];

/**
 * Get all private network ranges.
 */
export function getPrivateNetworkRanges(): PrivateNetworkRange[] {
  return [...PRIVATE_NETWORK_RANGES];
}

/**
 * Check if an IP address string falls within any private range.
 * Uses simple prefix matching for IPv4 ranges.
 * @param ip - IP address string
 * @returns true if the IP is in a private range
 */
export function isPrivateNetwork(ip: string): boolean {
  const patterns = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^192\.168\./,
    /^127\./,
    /^169\.254\./,
    /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./,
    /^198\.1[89]\./,
    /^::1$/,
    /^fe80:/i,
    /^fc/i,
    /^fd/i,
  ];
  return patterns.some((p) => p.test(ip));
}
