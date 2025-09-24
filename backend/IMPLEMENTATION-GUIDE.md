# Snapshot System Enhancement Implementation Guide

## Quick Start: Applying Optimizations

### Step 1: Update package.json

Add the compression dependency (already done):
```bash
npm install compression @types/compression
```

### Step 2: Apply Server Enhancements

Replace the current `server.ts` with `server-enhanced.ts`:

```bash
# Backup current server
cp server.ts server-original.ts

# Use enhanced version
cp server-enhanced.ts server.ts
```

Or apply changes incrementally:

#### Option A: Minimal Changes (Keep existing server.ts)

Add these lines to your existing `server.ts`:

```typescript
// After imports, add:
import compression from 'compression';

// After const app = express(), add:
app.use(compression({ threshold: 1024 }));

// Update JSON limit from 10mb to 50mb:
app.use(express.json({ limit: '50mb' }));

// After server.listen, add:
server.timeout = 300000; // 5 minutes
server.keepAliveTimeout = 30000; // 30 seconds
```

#### Option B: Full Enhanced Server

Use the provided `server-enhanced.ts` which includes:
- ✅ Compression middleware
- ✅ 50MB JSON limit
- ✅ Request timeouts
- ✅ Performance monitoring
- ✅ Enhanced health checks
- ✅ Request tracking
- ✅ Graceful shutdown

### Step 3: Environment Variables (Optional)

Create `.env` file for configuration:

```env
# Server Configuration
PORT=3001
JSON_LIMIT=50mb
URL_LIMIT=50mb
REQUEST_TIMEOUT=300000

# Development
NODE_ENV=development
```

### Step 4: Test the Changes

Run the performance test to verify improvements:

```bash
# Start server with enhanced configuration
npm run dev

# In another terminal, run performance test
node test-snapshot-perf-simple.js
```

Expected improvements:
- Response payloads compressed by 60-80%
- Support for files up to 50MB
- No timeout issues with large files
- Better error messages for oversized payloads

### Step 5: Client-Side Updates (Optional)

Update frontend API calls to handle compression:

```typescript
// frontend/lib/api.ts or similar

const uploadSnapshot = async (projectId: string, data: any) => {
  const response = await fetch(`/api/projects/${projectId}/snapshot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Optional: Request compression from server
      'Accept-Encoding': 'gzip, deflate, br'
    },
    body: JSON.stringify(data)
  });

  if (response.status === 413) {
    throw new Error('File too large. Please try a smaller script.');
  }

  if (response.status === 408) {
    throw new Error('Request timed out. Please try again.');
  }

  return response.json();
};
```

## Monitoring & Debugging

### New Health Endpoints

After applying enhancements, you'll have access to:

1. **Enhanced Health Check**
   ```bash
   curl http://localhost:3001/api/health
   ```
   Shows memory usage, configuration, and uptime.

2. **Performance Stats**
   ```bash
   curl http://localhost:3001/api/health/performance
   ```
   Shows detailed V8 heap statistics and CPU usage.

### Debugging Large Payload Issues

The enhanced server logs:
- Large payloads (>1MB) automatically
- Slow requests (>1 second)
- Connection errors with details
- Memory usage warnings

Check logs for patterns like:
```
📦 Large payload detected: 2.34 MB for POST /api/projects/123/snapshot
⚠️ Slow request: POST /api/projects/123/snapshot took 1234ms
```

## Rollback Plan

If issues occur after implementing changes:

1. **Immediate Rollback**
   ```bash
   cp server-original.ts server.ts
   npm run dev
   ```

2. **Gradual Rollback**
   - Remove compression first (most likely culprit)
   - Reduce JSON limit back to 10MB
   - Remove timeout configuration

## Performance Verification

After implementation, verify improvements:

```bash
# Compare before/after
node test-snapshot-perf-simple.js > after.log
diff before.log after.log
```

Expected results:
- POST payload size: ~40% reduction with compression
- Response times: Similar or slightly better
- Memory usage: Slightly higher but stable
- Error handling: More informative messages

## Next Steps

Once Phase 1 optimizations are stable:

1. **Add Client-Side Progress Indicators**
   ```typescript
   // Show upload progress for large files
   const uploadWithProgress = (data, onProgress) => {
     // Implementation
   };
   ```

2. **Implement Retry Logic**
   ```typescript
   // Auto-retry on timeout/network errors
   const uploadWithRetry = async (data, maxRetries = 3) => {
     // Implementation
   };
   ```

3. **Monitor Production Performance**
   - Set up logging aggregation
   - Track 95th percentile response times
   - Monitor memory trends

## Support & Troubleshooting

Common issues and solutions:

### Issue: "PayloadTooLargeError"
**Solution**: Increase JSON_LIMIT environment variable

### Issue: "Request timeout"
**Solution**: Increase REQUEST_TIMEOUT or optimize payload size

### Issue: High memory usage
**Solution**: Check for memory leaks, consider database storage

### Issue: Compression not working
**Solution**: Verify compression middleware is before body parser

## Questions?

The enhanced server is designed to be backward compatible. All existing API calls will continue to work, with added benefits of compression and better error handling.