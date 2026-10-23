'use strict';
// Official Cloudflare ranges from https://api.cloudflare.com/client/v4/ips, verified 2026-10-01.
// Render's external edge is Cloudflare; trust only these public hops, never all public proxies.
const ranges=[
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32"
];
const matches=require('proxy-addr').compile(ranges);
function isCloudflareProxy(address){try{return matches(String(address||''));}catch(_){return false;}}
// Non-geolocatable does not imply trusted. Documentation, benchmarking and
// multicast addresses must stop the chain instead of exposing a forged left hop.
const internalMatches=require('proxy-addr').compile([
  '10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','100.64.0.0/10',
  '127.0.0.0/8','169.254.0.0/16','::1/128','fc00::/7','fe80::/10'
]);
function isTrustedInternalProxy(address){try{return internalMatches(String(address||''));}catch(_){return false;}}
module.exports={isCloudflareProxy,isTrustedInternalProxy,ranges};
