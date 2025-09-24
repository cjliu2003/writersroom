# Upload Flow Validation Test Guide

## Overview
This comprehensive test suite ensures the upload flow works correctly and prevents regression of the critical routing bug where uploads were hitting the Next.js dev server instead of the Express backend.

## Test Coverage

### 1. Environment Configuration Tests (`upload-flow-validation.test.ts`)
- **API URL Validation**: Ensures NEXT_PUBLIC_API_BASE_URL is properly configured
- **Port Configuration**: Validates backend runs on port 3003, frontend on 3001
- **Rewrite Modes**: Tests both relative (with rewrites) and absolute (without rewrites) URL handling
- **Runtime Assertions**: Development mode checks for correct server routing

### 2. Upload Error Handling Tests (`upload-error-handling.test.tsx`)
- **404 Error Recovery**: UI properly handles backend unavailability
- **Server Error Handling**: Graceful handling of 500 errors
- **Timeout Management**: Proper timeout handling with user feedback
- **UI State Recovery**: Loading states cleared on error
- **File Validation**: Rejects non-FDX files before upload

### 3. StrictMode Protection Tests
- **Double-Invoke Prevention**: Guards against React StrictMode duplicate uploads
- **Upload State Management**: Proper ref-based upload tracking
- **Concurrent Upload Handling**: Prevents race conditions

### 4. Performance Metrics Tests
- **Parse Time Tracking**: Monitors FDX parsing performance
- **Snapshot POST Time**: Measures backend storage speed
- **Snapshot GET Time**: Tracks retrieval performance
- **Editor Mount Time**: Monitors UI initialization
- **Total Flow Time**: End-to-end performance measurement

### 5. Integration Tests (`upload-flow-e2e.test.ts`)
- **Complete Upload Flow**: End-to-end testing from file selection to editor
- **Large File Handling**: Tests with 100+ scene scripts
- **Concurrent Uploads**: Multiple simultaneous upload handling
- **Error Recovery**: Backend unavailability scenarios

## Setup Instructions

### Prerequisites
```bash
# Install dependencies in both directories
cd backend && npm install
cd ../frontend && npm install

# Install test dependencies
npm install -D jest @testing-library/react @testing-library/user-event
npm install -D supertest @types/supertest
```

### Environment Configuration

1. **Backend (.env)**
```bash
# backend/.env
NODE_ENV=development
PORT=3003
CORS_ORIGIN=http://localhost:3001
```

2. **Frontend (.env.local)**
```bash
# frontend/.env.local
NEXT_PUBLIC_API_BASE_URL=http://localhost:3003
```

### Running Tests

#### Run All Tests
```bash
# Backend tests
cd backend
npm test

# Frontend tests
cd frontend
npm test
```

#### Run Specific Test Suites
```bash
# Environment configuration tests
npm test upload-flow-validation

# UI error handling tests
npm test upload-error-handling

# Integration tests
npm test upload-flow-e2e
```

#### Run with Coverage
```bash
npm test -- --coverage
```

#### Debug Mode
```bash
# Enable console output in tests
DEBUG_TESTS=true npm test
```

## Test Execution Order

For comprehensive validation, run tests in this order:

1. **Unit Tests First**
   ```bash
   npm test upload-flow-validation.test.ts
   ```

2. **UI Component Tests**
   ```bash
   npm test upload-error-handling.test.tsx
   ```

3. **Integration Tests**
   ```bash
   npm test upload-flow-e2e.test.ts
   ```

## Expected Results

### Successful Test Run
```
✓ Environment Configuration Tests (12 tests)
  ✓ should fail if NEXT_PUBLIC_API_BASE_URL is missing in production
  ✓ should use default localhost URL in development
  ✓ should validate URL format
  ✓ should handle rewrites mode correctly
  ✓ should handle non-rewrites mode correctly
  ✓ should provide runtime assertion in development
  ✓ should ensure backend runs on correct port (3003)
  ✓ should detect port conflicts

✓ Upload Error Handling Tests (10 tests)
  ✓ should show error message when upload returns 404
  ✓ should re-enable upload button after error
  ✓ should not show loading spinner after error
  ✓ should handle server errors gracefully
  ✓ should handle network timeouts
  ✓ should reset all loading states on error
  ✓ should allow retry after error

✓ Performance Metrics Tests (5 tests)
  ✓ should log parse time < 5000ms
  ✓ should log snapshot POST time < 10000ms
  ✓ should log snapshot GET time < 5000ms
  ✓ should log editor mount time
  ✓ should log total flow time < 30000ms

Test Suites: 3 passed, 3 total
Tests: 27 passed, 27 total
Time: 15.234s
```

### Performance Benchmarks

Expected performance metrics for typical operations:

| Operation | Expected Time | Max Acceptable |
|-----------|--------------|----------------|
| FDX Parse (10 scenes) | 50-200ms | 5000ms |
| FDX Parse (100 scenes) | 500-2000ms | 10000ms |
| Snapshot POST | 100-500ms | 10000ms |
| Snapshot GET | 50-200ms | 5000ms |
| Editor Mount | 200-1000ms | 5000ms |
| Total Flow | 500-3000ms | 30000ms |

## Troubleshooting Guide

### Common Issues and Solutions

#### 1. "API URL required in production" Error
**Problem**: Test fails in production environment without API URL
**Solution**:
```bash
export NEXT_PUBLIC_API_BASE_URL=https://your-api-url.com
```

#### 2. Port Already in Use (EADDRINUSE)
**Problem**: Test server can't start on specified port
**Solution**:
```bash
# Find and kill process using port 3003
lsof -i :3003
kill -9 <PID>

# Or use different port in tests
PORT=3004 npm test
```

#### 3. Upload Timeout Errors
**Problem**: Large file uploads timing out
**Solution**:
- Increase timeout in test configuration:
```javascript
jest.setTimeout(30000) // 30 seconds
```
- Check network connectivity
- Reduce file size for testing

#### 4. StrictMode Double Invocation
**Problem**: Upload happening twice in development
**Solution**:
- Verify `hasUploadedRef` guard is in place
- Check that ref is properly reset for new uploads
- Ensure cleanup in useEffect

#### 5. 404 Errors During Upload
**Problem**: Upload fails with 404 Not Found
**Root Cause**: Requests going to wrong server
**Solution**:
```bash
# Verify backend is running on port 3003
cd backend && npm run dev

# Verify frontend API configuration
echo $NEXT_PUBLIC_API_BASE_URL
# Should output: http://localhost:3003

# Check Next.js route exists
ls frontend/app/api/fdx/import/route.ts
```

#### 6. Performance Test Failures
**Problem**: Tests failing due to slow performance
**Solutions**:
- Run tests on a faster machine
- Increase timeout thresholds
- Run performance tests separately:
```bash
npm test -- --testNamePattern="Performance"
```

#### 7. Mock Data Issues
**Problem**: Tests failing due to invalid mock FDX
**Solution**: Use provided test utilities:
```javascript
import { integrationTestUtils } from './upload-flow-e2e.test'
const mockFDX = integrationTestUtils.createMockFDX(10)
```

### Debugging Tips

#### Enable Verbose Logging
```javascript
// In test files
console.log = jest.fn(console.log) // Keep console output
process.env.DEBUG_TESTS = 'true'
```

#### Check Server Status
```bash
# Verify Express backend is running
curl http://localhost:3003/health

# Test upload endpoint directly
curl -X POST http://localhost:3003/api/fdx/import \
  -F "fdx=@test.fdx"
```

#### Inspect Network Traffic
```javascript
// Add to test
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`)
  next()
})
```

#### Test Individual Components
```bash
# Test only environment config
npm test -- --testNamePattern="Environment Configuration"

# Test only error handling
npm test -- --testNamePattern="Error Handling"
```

## CI/CD Integration

### GitHub Actions Example
```yaml
name: Upload Flow Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v2

    - name: Setup Node
      uses: actions/setup-node@v2
      with:
        node-version: '18'

    - name: Install Backend Dependencies
      run: cd backend && npm ci

    - name: Install Frontend Dependencies
      run: cd frontend && npm ci

    - name: Run Backend Tests
      run: cd backend && npm test
      env:
        NODE_ENV: test
        PORT: 3003

    - name: Run Frontend Tests
      run: cd frontend && npm test
      env:
        NEXT_PUBLIC_API_BASE_URL: http://localhost:3003

    - name: Upload Coverage
      uses: codecov/codecov-action@v2
      with:
        files: ./backend/coverage/lcov.info,./frontend/coverage/lcov.info
```

## Maintenance

### Adding New Tests
1. Follow the existing test structure
2. Use descriptive test names
3. Include both positive and negative cases
4. Add performance assertions where relevant
5. Update this documentation

### Updating Mock Data
- Mock FDX files are in test utilities
- Update `MOCK_FDX_CONTENT` constant for new scenarios
- Use `createMockFDX()` helper for dynamic content

### Performance Baseline Updates
If performance improves, update baseline metrics:
1. Run performance tests 10 times
2. Calculate average times
3. Update expected ranges in documentation
4. Commit new baselines with justification

## Contact & Support

For issues with the test suite:
1. Check this troubleshooting guide
2. Review test output carefully
3. Enable debug logging
4. Check environment configuration
5. Verify all services are running

Remember: These tests are critical for preventing the upload routing regression. Always run them before deploying changes to the upload flow.