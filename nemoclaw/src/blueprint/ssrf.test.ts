// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { validateEndpoint, validateEndpoints, isIPv4, isIPv6 } from './ssrf.js';

describe('SSRF Validation', () => {
  describe('validateEndpoint', () => {
    it('should allow public hostnames', () => {
      const result = validateEndpoint('api.nvidia.com');
      expect(result.safe).toBe(true);
    });

    it('should allow public IPs', () => {
      const result = validateEndpoint('8.8.8.8');
      expect(result.safe).toBe(true);
    });

    it('should block loopback 127.0.0.1', () => {
      const result = validateEndpoint('127.0.0.1');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('blocked range');
    });

    it('should block localhost hostname', () => {
      const result = validateEndpoint('localhost');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('blocked hostname');
    });

    it('should block private RFC 1918 range 10.x.x.x', () => {
      expect(validateEndpoint('10.0.0.1').safe).toBe(false);
      expect(validateEndpoint('10.255.255.255').safe).toBe(false);
    });

    it('should block private RFC 1918 range 172.16-31.x.x', () => {
      expect(validateEndpoint('172.16.0.1').safe).toBe(false);
      expect(validateEndpoint('172.31.255.255').safe).toBe(false);
    });

    it('should allow 172.32+ (not private)', () => {
      expect(validateEndpoint('172.32.0.1').safe).toBe(true);
    });

    it('should block private RFC 1918 range 192.168.x.x', () => {
      expect(validateEndpoint('192.168.1.1').safe).toBe(false);
    });

    it('should block AWS metadata 169.254.169.254', () => {
      expect(validateEndpoint('169.254.169.254').safe).toBe(false);
    });

    it('should block IPv6 loopback ::1', () => {
      expect(validateEndpoint('::1').safe).toBe(false);
    });

    it('should block IPv6 link-local fe80::', () => {
      expect(validateEndpoint('fe80::1').safe).toBe(false);
    });

    it('should block .internal hostnames', () => {
      expect(validateEndpoint('service.internal').safe).toBe(false);
    });

    it('should block metadata.google.internal', () => {
      expect(validateEndpoint('metadata.google.internal').safe).toBe(false);
    });

    it('should return safe result with host preserved', () => {
      const result = validateEndpoint('github.com');
      expect(result.host).toBe('github.com');
      expect(result.safe).toBe(true);
    });

    it('should handle empty host', () => {
      expect(validateEndpoint('').safe).toBe(false);
    });
  });

  describe('validateEndpoints', () => {
    it('should return only unsafe results', () => {
      const hosts = ['api.nvidia.com', '127.0.0.1', 'github.com', '192.168.1.1'];
      const unsafe = validateEndpoints(hosts);
      expect(unsafe).toHaveLength(2);
      expect(unsafe.map((r) => r.host)).toContain('127.0.0.1');
      expect(unsafe.map((r) => r.host)).toContain('192.168.1.1');
    });

    it('should return empty array when all safe', () => {
      const unsafe = validateEndpoints(['api.nvidia.com', '8.8.8.8']);
      expect(unsafe).toHaveLength(0);
    });
  });

  describe('isIPv4', () => {
    it('should detect IPv4 addresses', () => {
      expect(isIPv4('192.168.1.1')).toBe(true);
      expect(isIPv4('8.8.8.8')).toBe(true);
      expect(isIPv4('example.com')).toBe(false);
    });
  });

  describe('isIPv6', () => {
    it('should detect IPv6 addresses', () => {
      expect(isIPv6('::1')).toBe(true);
      expect(isIPv6('fe80::1')).toBe(true);
      expect(isIPv6('192.168.1.1')).toBe(false);
    });
  });
});
