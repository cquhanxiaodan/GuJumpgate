const assert = require('node:assert/strict');
const test = require('node:test');

require('../phone-sms/providers/nextaction-nexsms.js');

function createProvider(overrides = {}) {
  return globalThis.PhoneSmsNextActionNexSmsProvider.createProvider({
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    ...overrides,
  });
}

test('NextAction NexSMS requests orders with documented API shape', async () => {
  const requests = [];
  const provider = createProvider({
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (url.includes('/api/v1/countries')) {
        return {
          ok: true,
          text: async () => JSON.stringify({ countries: [{ code: 'US', has_stock: true, stock_count: 1 }] }),
        };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({
          orders: [{
            id: 'order-1',
            phone_number_full: '+13000000000',
            country_code: 'US',
            country: '美国（实体卡）',
            api_sms_url: 'https://sms.nextactionplus.com/api/v1/sms-url/order-1',
            status: 'waiting_sms',
          }],
        }),
      };
    },
  });

  const activation = await provider.requestActivation({
    nextActionNexSmsApiKey: 'nx_sms_test',
    nextActionNexSmsCountryOrder: ['US'],
    nextActionNexSmsServiceCode: '671',
    nextActionNexSmsPricingOption: 1,
  });

  assert.equal(activation.provider, 'nextaction-nexsms');
  assert.equal(activation.activationId, 'order-1');
  assert.equal(activation.phoneNumber, '+13000000000');
  assert.equal(activation.maxUses, 3);
  assert.equal(requests[0].url, 'https://sms.nextactionplus.com/api/v1/countries?service=671');
  assert.equal(requests[1].url, 'https://sms.nextactionplus.com/api/v1/orders');
  assert.equal(requests[1].init.method, 'POST');
  assert.equal(requests[1].init.headers.Authorization, 'Bearer nx_sms_test');
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    service: '671',
    country: 'US',
    pricing_option: 1,
    quantity: 1,
  });
});

test('NextAction NexSMS reuses existing order through resend API', async () => {
  const requests = [];
  const provider = createProvider({
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/api/v1/orders/order-1')) {
        return {
          ok: true,
          text: async () => JSON.stringify({ order: { id: 'order-1', status: 'sms_received' } }),
        };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({
          order: {
            id: 'order-1',
            phone_number_full: '+13000000000',
            country_code: 'US',
            status: 'sms_received',
          },
        }),
      };
    },
  });

  const activation = await provider.reuseActivation(
    { nextActionNexSmsApiKey: 'nx_sms_test' },
    {
      activationId: 'order-1',
      phoneNumber: '+13000000000',
      provider: 'nextaction-nexsms',
      serviceCode: '671',
      countryId: 'US',
      maxUses: 3,
      successfulUses: 1,
    }
  );

  assert.equal(activation.activationId, 'order-1');
  assert.equal(activation.phoneNumber, '+13000000000');
  assert.equal(activation.successfulUses, 1);
  assert.equal(requests[0].url, 'https://sms.nextactionplus.com/api/v1/orders/order-1');
  assert.equal(requests[1].url, 'https://sms.nextactionplus.com/api/v1/orders/order-1/resend');
  assert.equal(requests[1].init.method, 'POST');
});

test('NextAction NexSMS skips countries without stock before ordering', async () => {
  const requests = [];
  const provider = createProvider({
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (url.includes('/api/v1/countries')) {
        return {
          ok: true,
          text: async () => JSON.stringify({
            countries: [
              { code: 'US', name: 'United States', has_stock: false, stock_count: 0 },
              { code: 'GB', name: 'United Kingdom', has_stock: true, stock_count: 2 },
            ],
          }),
        };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({
          orders: [{ id: 'order-gb', phone_number_full: '+447700900000', country_code: 'GB' }],
        }),
      };
    },
  });

  const activation = await provider.requestActivation({
    nextActionNexSmsApiKey: 'nx_sms_test',
    nextActionNexSmsCountryOrder: ['US', 'GB'],
  });

  assert.equal(activation.activationId, 'order-gb');
  assert.equal(JSON.parse(requests[1].init.body).country, 'GB');
});

test('NextAction NexSMS chooses the cheapest country when price priority is enabled', async () => {
  const requests = [];
  const provider = createProvider({
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (url.includes('/api/v1/countries')) {
        return {
          ok: true,
          text: async () => JSON.stringify({
            countries: [
              { code: 'US', has_stock: true, stock_count: 1 },
              { code: 'GB', has_stock: true, stock_count: 1 },
            ],
          }),
        };
      }
      if (url.includes('/api/v1/prices') && url.includes('country=US')) {
        return { ok: true, text: async () => JSON.stringify({ prices: [{ pricing_option: 0, price_cents: 300 }, { pricing_option: 1, price_cents: 900 }] }) };
      }
      if (url.includes('/api/v1/prices') && url.includes('country=GB')) {
        return { ok: true, text: async () => JSON.stringify({ prices: [{ pricing_option: 0, price_cents: 120 }, { pricing_option: 1, price_cents: 250 }] }) };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({ orders: [{ id: 'order-gb', phone_number_full: '+447700900000', country_code: 'GB' }] }),
      };
    },
  });

  const activation = await provider.requestActivation({
    nextActionNexSmsApiKey: 'nx_sms_test',
    nextActionNexSmsCountryOrder: ['US', 'GB'],
    nextActionNexSmsPricingOption: 1,
    heroSmsAcquirePriority: 'price',
  });

  assert.equal(activation.activationId, 'order-gb');
  const orderRequest = requests.find((request) => request.url.endsWith('/api/v1/orders'));
  assert.deepEqual(JSON.parse(orderRequest.init.body), {
    service: '671',
    country: 'GB',
    pricing_option: 0,
    quantity: 1,
  });
});

test('NextAction NexSMS prefers high success price option inside price range', async () => {
  const requests = [];
  const provider = createProvider({
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (url.includes('/api/v1/countries')) {
        return {
          ok: true,
          text: async () => JSON.stringify({ countries: [{ code: 'US', has_stock: true, stock_count: 1 }] }),
        };
      }
      if (url.includes('/api/v1/prices')) {
        return {
          ok: true,
          text: async () => JSON.stringify({
            prices: [
              { pricing_option: 0, price_cents: 100 },
              { pricing_option: 1, price_cents: 180 },
            ],
          }),
        };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({ orders: [{ id: 'order-us', phone_number_full: '+13000000000', country_code: 'US' }] }),
      };
    },
  });

  await provider.requestActivation({
    nextActionNexSmsApiKey: 'nx_sms_test',
    nextActionNexSmsCountryOrder: ['US'],
    nextActionNexSmsPricingOption: 1,
    heroSmsAcquirePriority: 'price_high',
    heroSmsMinPrice: '1.50',
    heroSmsMaxPrice: '2.00',
  });

  const orderRequest = requests.find((request) => request.url.endsWith('/api/v1/orders'));
  assert.equal(JSON.parse(orderRequest.init.body).pricing_option, 1);
});

test('NextAction NexSMS skips countries outside price range', async () => {
  const requests = [];
  const provider = createProvider({
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (url.includes('/api/v1/countries')) {
        return {
          ok: true,
          text: async () => JSON.stringify({
            countries: [
              { code: 'US', has_stock: true, stock_count: 1 },
              { code: 'GB', has_stock: true, stock_count: 1 },
            ],
          }),
        };
      }
      if (url.includes('/api/v1/prices') && url.includes('country=US')) {
        return { ok: true, text: async () => JSON.stringify({ prices: [{ pricing_option: 0, price_cents: 500 }] }) };
      }
      if (url.includes('/api/v1/prices') && url.includes('country=GB')) {
        return { ok: true, text: async () => JSON.stringify({ prices: [{ pricing_option: 0, price_cents: 150 }] }) };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({ orders: [{ id: 'order-gb', phone_number_full: '+447700900000', country_code: 'GB' }] }),
      };
    },
  });

  await provider.requestActivation({
    nextActionNexSmsApiKey: 'nx_sms_test',
    nextActionNexSmsCountryOrder: ['US', 'GB'],
    heroSmsAcquirePriority: 'price',
    heroSmsMaxPrice: '2.00',
  });

  const orderRequest = requests.find((request) => request.url.endsWith('/api/v1/orders'));
  assert.equal(JSON.parse(orderRequest.init.body).country, 'GB');
});

test('NextAction NexSMS rejects expired reusable orders', async () => {
  const provider = createProvider({
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify({ order: { id: 'order-1', status: 'expired' } }),
    }),
  });

  await assert.rejects(
    () => provider.reuseActivation(
      { nextActionNexSmsApiKey: 'nx_sms_test' },
      { activationId: 'order-1', phoneNumber: '+13000000000', provider: 'nextaction-nexsms' }
    ),
    /不可复用/
  );
});

test('NextAction NexSMS fetches price options', async () => {
  const provider = createProvider({
    fetchImpl: async (url) => {
      assert.equal(url, 'https://sms.nextactionplus.com/api/v1/prices?service=671&country=US');
      return {
        ok: true,
        text: async () => JSON.stringify({ prices: [{ pricing_option: 0, label: '最低价', price_cents: 220 }] }),
      };
    },
  });

  const payload = await provider.fetchPrices({ nextActionNexSmsApiKey: 'nx_sms_test' }, { id: 'US' });
  assert.equal(payload.prices[0].priceCents, 220);
});

test('NextAction NexSMS fetches services and orders', async () => {
  const provider = createProvider({
    fetchImpl: async (url) => {
      if (url.endsWith('/api/v1/services')) {
        return {
          ok: true,
          text: async () => JSON.stringify({ services: [{ code: '671', name: 'OpenAI' }] }),
        };
      }
      assert.equal(url, 'https://sms.nextactionplus.com/api/v1/orders?page=1&page_size=50');
      return {
        ok: true,
        text: async () => JSON.stringify({ orders: [{ id: 'order-1', phone_number_full: '+13000000000', country_code: 'US' }] }),
      };
    },
  });

  const services = await provider.fetchServices({ nextActionNexSmsApiKey: 'nx_sms_test' });
  assert.equal(services[0].code, '671');
  const orders = await provider.fetchOrders({ nextActionNexSmsApiKey: 'nx_sms_test' });
  assert.equal(orders[0].activationId, 'order-1');
});

test('NextAction NexSMS parses phone sms url credentials', () => {
  const provider = createProvider();
  const activation = provider.parsePhoneSmsUrlCredential('13000000000----https://sms.nextactionplus.com/api/orders/order-1/sms-url?token=abc');
  assert.equal(activation.activationId, 'order-1');
  assert.equal(activation.phoneNumber, '13000000000');
  assert.equal(activation.provider, 'nextaction-nexsms');
});

test('NextAction NexSMS skips cancel when sms already received', async () => {
  const requests = [];
  const provider = createProvider({
    fetchImpl: async (url) => {
      requests.push(url);
      return {
        ok: true,
        text: async () => JSON.stringify({ status: 'YES', received: true, code: '123456' }),
      };
    },
  });

  const result = await provider.cancelActivation(
    { nextActionNexSmsApiKey: 'nx_sms_test' },
    { activationId: 'order-1' }
  );
  assert.match(result, /跳过释放/);
  assert.equal(requests.length, 1);
});

test('NextAction NexSMS extracts verification code from JSON sms response', async () => {
  const provider = createProvider({
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify({
        status: 'YES',
        received: true,
        code: '123456',
        message: 'Your OpenAI verification code is: 123456',
      }),
    }),
  });

  const code = await provider.pollActivationCode(
    { nextActionNexSmsApiKey: 'nx_sms_test' },
    { activationId: 'order-1' },
    { timeoutMs: 1000, intervalMs: 1 }
  );

  assert.equal(code, '123456');
});
