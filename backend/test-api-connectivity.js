#!/usr/bin/env node

/**
 * API Connectivity Test Script
 * Tests all critical API endpoints to ensure proper communication
 */

const http = require('http');

const API_PORT = 3003;
const BASE_URL = `http://localhost:${API_PORT}`;

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testEndpoint(path, method = 'GET', body = null) {
  return new Promise((resolve) => {
    const url = new URL(path, BASE_URL);

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve({
          success: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          data: data,
          path: path
        });
      });
    });

    req.on('error', (error) => {
      resolve({
        success: false,
        status: 0,
        error: error.message,
        path: path
      });
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

async function runTests() {
  log('\n===================================', 'blue');
  log('API CONNECTIVITY TEST', 'blue');
  log(`Testing backend at ${BASE_URL}`, 'blue');
  log('===================================\n', 'blue');

  const tests = [
    {
      name: 'Health Check',
      path: '/api/health'
    },
    {
      name: 'Memory API - Get All Scenes',
      path: '/api/memory/all?projectId=test_project'
    },
    {
      name: 'Snapshot API - Get Project',
      path: '/api/projects/test_project/snapshot'
    },
    {
      name: 'Projects List',
      path: '/api/projects/list'
    }
  ];

  let allPassed = true;

  for (const test of tests) {
    process.stdout.write(`Testing ${test.name}... `);

    const result = await testEndpoint(test.path, test.method || 'GET', test.body);

    if (result.success) {
      log('✅ PASSED', 'green');
      log(`  Status: ${result.status}`, 'green');

      try {
        const json = JSON.parse(result.data);
        if (json.success !== undefined) {
          log(`  Response: success=${json.success}`, 'green');
        }
      } catch {
        // Not JSON response
      }
    } else {
      allPassed = false;
      log('❌ FAILED', 'red');

      if (result.status === 0) {
        log(`  Error: ${result.error}`, 'red');
        log(`  Is the backend server running on port ${API_PORT}?`, 'yellow');
      } else {
        log(`  Status: ${result.status}`, 'red');
        log(`  Response: ${result.data}`, 'red');
      }
    }

    console.log('');
  }

  // Test CORS from simulated browser origin
  log('Testing CORS Configuration...', 'blue');
  const corsResult = await new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: API_PORT,
      path: '/api/health',
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3100',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    };

    const req = http.request(options, (res) => {
      const corsHeaders = {
        'access-control-allow-origin': res.headers['access-control-allow-origin'],
        'access-control-allow-methods': res.headers['access-control-allow-methods'],
        'access-control-allow-headers': res.headers['access-control-allow-headers'],
        'access-control-allow-credentials': res.headers['access-control-allow-credentials']
      };

      resolve({
        success: res.statusCode === 204 || res.statusCode === 200,
        status: res.statusCode,
        headers: corsHeaders
      });
    });

    req.on('error', (error) => {
      resolve({
        success: false,
        error: error.message
      });
    });

    req.end();
  });

  if (corsResult.success) {
    log('✅ CORS PASSED', 'green');
    log(`  Allow-Origin: ${corsResult.headers['access-control-allow-origin']}`, 'green');
    log(`  Allow-Methods: ${corsResult.headers['access-control-allow-methods']}`, 'green');
    log(`  Allow-Credentials: ${corsResult.headers['access-control-allow-credentials']}`, 'green');
  } else {
    allPassed = false;
    log('❌ CORS FAILED', 'red');
    if (corsResult.error) {
      log(`  Error: ${corsResult.error}`, 'red');
    } else {
      log(`  Status: ${corsResult.status}`, 'red');
    }
  }

  log('\n===================================', 'blue');
  if (allPassed) {
    log('✅ ALL TESTS PASSED', 'green');
    log('API is properly configured and running!', 'green');
  } else {
    log('❌ SOME TESTS FAILED', 'red');
    log('Please check the backend server configuration.', 'yellow');
    log(`\nTo start the backend server:`, 'yellow');
    log(`  cd backend`, 'yellow');
    log(`  npm run dev`, 'yellow');
  }
  log('===================================\n', 'blue');

  process.exit(allPassed ? 0 : 1);
}

// Run the tests
runTests().catch((error) => {
  log(`\n❌ Test script error: ${error.message}`, 'red');
  process.exit(1);
});