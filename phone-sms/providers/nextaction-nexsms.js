(function attachNextActionNexSmsProvider(root, factory) {
  root.PhoneSmsNextActionNexSmsProvider = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createNextActionNexSmsProviderModule() {
  const PROVIDER_ID = 'nextaction-nexsms';
  const PROVIDER_LABEL = 'NexSMS NextAction';
  const DEFAULT_BASE_URL = 'https://sms.nextactionplus.com';
  const DEFAULT_SERVICE_CODE = '671';
  const DEFAULT_COUNTRY_ORDER = Object.freeze(['US']);
  const DEFAULT_PRICING_OPTION = 0;
  const DEFAULT_SUCCESSFUL_TASK_MAX_USES = 3;
  const DEFAULT_REQUEST_TIMEOUT_MS = 20000;
  const PHONE_CODE_TIMEOUT_ERROR_PREFIX = 'PHONE_CODE_TIMEOUT::';
  const ACQUIRE_PRIORITY_COUNTRY = 'country';
  const ACQUIRE_PRIORITY_PRICE = 'price';
  const ACQUIRE_PRIORITY_PRICE_HIGH = 'price_high';

  function normalizeServiceCode(value = '', fallback = DEFAULT_SERVICE_CODE) {
    return String(value || '').trim() || fallback;
  }

  function normalizeCountryCode(value = '', fallback = 'US') {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '') || fallback;
  }

  function normalizeCountryOrder(value = []) {
    const source = Array.isArray(value)
      ? value
      : String(value || '').split(/[\r\n,，;；]+/).map((entry) => entry.trim()).filter(Boolean);
    const seen = new Set();
    const normalized = [];
    source.forEach((entry) => {
      const code = normalizeCountryCode(
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? (entry.code || entry.id || entry.country || '')
          : entry,
        ''
      );
      if (!code || seen.has(code)) return;
      seen.add(code);
      normalized.push(code);
    });
    return normalized.length ? normalized.slice(0, 10) : [...DEFAULT_COUNTRY_ORDER];
  }

  function normalizePricingOption(value = DEFAULT_PRICING_OPTION) {
    const parsed = Math.floor(Number(value));
    return parsed === 1 ? 1 : DEFAULT_PRICING_OPTION;
  }

  function normalizeAcquirePriority(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === ACQUIRE_PRIORITY_PRICE) return ACQUIRE_PRIORITY_PRICE;
    if (normalized === ACQUIRE_PRIORITY_PRICE_HIGH) return ACQUIRE_PRIORITY_PRICE_HIGH;
    return ACQUIRE_PRIORITY_COUNTRY;
  }

  function normalizePriceLimit(value = '') {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function priceLimitToCents(value = '') {
    const normalized = normalizePriceLimit(value);
    return normalized === null ? null : Math.round(normalized * 100);
  }

  function normalizeBaseUrl(value = '') {
    const raw = String(value || '').trim() || DEFAULT_BASE_URL;
    try {
      const parsed = new URL(raw);
      parsed.hash = '';
      parsed.search = '';
      return parsed.toString().replace(/\/+$/, '');
    } catch {
      return DEFAULT_BASE_URL;
    }
  }

  function parsePayload(text = '') {
    const trimmed = String(text || '').trim();
    if (!trimmed) return '';
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  function describePayload(payload) {
    if (typeof payload === 'string') return payload.trim();
    if (payload && typeof payload === 'object') {
      const message = String(payload.error || payload.message || payload.msg || payload.status || '').trim();
      if (message) return message;
      try {
        return JSON.stringify(payload);
      } catch {
        return String(payload);
      }
    }
    return String(payload || '').trim();
  }

  function resolveConfig(state = {}, deps = {}) {
    return {
      apiKey: String(state.nextActionNexSmsApiKey || '').trim(),
      baseUrl: normalizeBaseUrl(state.nextActionNexSmsBaseUrl),
      serviceCode: normalizeServiceCode(state.nextActionNexSmsServiceCode),
      countryOrder: normalizeCountryOrder(state.nextActionNexSmsCountryOrder),
      pricingOption: normalizePricingOption(state.nextActionNexSmsPricingOption),
      acquirePriority: normalizeAcquirePriority(state.heroSmsAcquirePriority),
      minPriceCents: priceLimitToCents(state.heroSmsMinPrice),
      maxPriceCents: priceLimitToCents(state.heroSmsMaxPrice),
      fetchImpl: deps.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
      requestTimeoutMs: deps.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
    };
  }

  function assertValidPriceRange(config) {
    if (config.minPriceCents !== null && config.maxPriceCents !== null && config.minPriceCents > config.maxPriceCents) {
      throw new Error(`NexSMS NextAction 价格区间无效：最低购买价 ${(config.minPriceCents / 100).toFixed(4)} 高于价格上限 ${(config.maxPriceCents / 100).toFixed(4)}。`);
    }
  }

  function isPriceWithinLimits(priceCents, config) {
    if (priceCents === null) return config.minPriceCents === null && config.maxPriceCents === null;
    if (config.minPriceCents !== null && priceCents < config.minPriceCents) return false;
    if (config.maxPriceCents !== null && priceCents > config.maxPriceCents) return false;
    return true;
  }

  async function fetchPayload(config, path, actionLabel, options = {}) {
    if (!config.apiKey) throw new Error('NexSMS NextAction API Key 缺失，请先在侧边栏保存 API Key。');
    if (typeof config.fetchImpl !== 'function') throw new Error('NexSMS NextAction 网络请求实现不可用。');

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), config.requestTimeoutMs) : null;
    try {
      const method = String(options.method || 'GET').toUpperCase();
      const url = /^https?:\/\//i.test(path)
        ? new URL(path)
        : new URL(path.replace(/^\/+/, ''), `${config.baseUrl}/`);
      const query = options.query && typeof options.query === 'object' ? options.query : {};
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
      });
      const headers = {
        Accept: 'application/json, text/plain, */*',
        Authorization: `Bearer ${config.apiKey}`,
        ...(options.headers && typeof options.headers === 'object' ? options.headers : {}),
      };
      const init = { method, headers, signal: controller?.signal };
      if (method !== 'GET' && method !== 'HEAD' && options.body !== undefined) {
        init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
      }
      const response = await config.fetchImpl(url.toString(), init);
      const payload = parsePayload(await response.text());
      if (!response.ok) {
        const error = new Error(`${actionLabel}失败：${describePayload(payload) || response.status}`);
        error.payload = payload;
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`${actionLabel}超时。`);
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function resolveCountryCandidates(state = {}) {
    return normalizeCountryOrder(state.nextActionNexSmsCountryOrder).map((code) => ({ id: code, label: code }));
  }

  function normalizeCountryRecord(record = {}) {
    const code = normalizeCountryCode(record.code || record.country_code || record.country || record.id || '', '');
    if (!code) return null;
    const name = String(record.name || record.country || record.label || code).trim() || code;
    const stockCount = Number(record.stock_count ?? record.stock ?? record.count);
    const minPriceCents = Number(record.min_price_cents ?? record.minPriceCents);
    return {
      id: code,
      code,
      label: name === code ? code : `${name} [${code}]`,
      name,
      hasStock: record.has_stock !== undefined ? Boolean(record.has_stock) : (!Number.isFinite(stockCount) || stockCount > 0),
      stockCount: Number.isFinite(stockCount) ? stockCount : null,
      minPriceCents: Number.isFinite(minPriceCents) ? minPriceCents : null,
    };
  }

  function normalizePriceOption(record = {}) {
    const pricingOption = normalizePricingOption(record.pricing_option ?? record.pricingOption ?? record.option ?? 0);
    const priceCents = Number(record.price_cents ?? record.price ?? record.amount_cents ?? record.cost_cents);
    return {
      pricingOption,
      label: String(record.label || record.name || (pricingOption === 1 ? '高成功率' : '最低价')).trim(),
      priceCents: Number.isFinite(priceCents) ? priceCents : null,
      raw: record,
    };
  }

  async function resolveCountryPricePlan(state = {}, country = {}, config = resolveConfig(state), deps = {}) {
    const payload = await fetchPrices(state, country, deps);
    const prices = Array.isArray(payload?.prices) ? payload.prices : [];
    const eligiblePrices = prices
      .filter((entry) => isPriceWithinLimits(entry.priceCents, config))
      .sort((left, right) => (left.priceCents ?? Number.POSITIVE_INFINITY) - (right.priceCents ?? Number.POSITIVE_INFINITY));
    const selectedPrice = config.acquirePriority === ACQUIRE_PRIORITY_PRICE_HIGH
      ? (eligiblePrices.find((entry) => entry.pricingOption === 1) || eligiblePrices[0] || null)
      : config.acquirePriority === ACQUIRE_PRIORITY_PRICE
      ? (eligiblePrices[0] || null)
      : (eligiblePrices.find((entry) => entry.pricingOption === config.pricingOption) || eligiblePrices[0] || null);
    return {
      country,
      countryId: country.id,
      countryLabel: country.label || country.id,
      prices,
      eligiblePrices,
      selectedPrice,
    };
  }

  async function buildOrderPlans(state = {}, countries = [], config = resolveConfig(state), deps = {}) {
    const hasPriceBounds = config.minPriceCents !== null || config.maxPriceCents !== null;
    if (config.acquirePriority === ACQUIRE_PRIORITY_COUNTRY && !hasPriceBounds) {
      return countries.map((country) => ({
        country,
        countryId: country.id,
        countryLabel: country.label || country.id,
        selectedPrice: { pricingOption: config.pricingOption, priceCents: null },
      }));
    }

    const plans = [];
    for (const country of countries) {
      try {
        const plan = await resolveCountryPricePlan(state, country, config, deps);
        if (!plan.eligiblePrices.length) {
          if (typeof deps.addLog === 'function') {
            await deps.addLog(`步骤 9：NexSMS NextAction ${plan.countryLabel} 没有符合价格区间的档位，已跳过。`, 'info');
          }
          continue;
        }
        plans.push(plan);
      } catch (error) {
        if (config.acquirePriority === ACQUIRE_PRIORITY_COUNTRY && !hasPriceBounds) {
          plans.push({
            country,
            countryId: country.id,
            countryLabel: country.label || country.id,
            selectedPrice: { pricingOption: config.pricingOption, priceCents: null },
          });
          continue;
        }
        if (typeof deps.addLog === 'function') {
          await deps.addLog(`步骤 9：NexSMS NextAction ${country.label} 价格查询失败，已跳过。${error.message}`, 'warn');
        }
      }
    }

    return plans.sort((left, right) => {
      if (config.acquirePriority === ACQUIRE_PRIORITY_PRICE_HIGH) {
        const leftHigh = left.selectedPrice?.pricingOption === 1 ? 0 : 1;
        const rightHigh = right.selectedPrice?.pricingOption === 1 ? 0 : 1;
        if (leftHigh !== rightHigh) return leftHigh - rightHigh;
      }
      if (config.acquirePriority === ACQUIRE_PRIORITY_PRICE || config.acquirePriority === ACQUIRE_PRIORITY_PRICE_HIGH) {
        const leftPrice = left.selectedPrice?.priceCents ?? Number.POSITIVE_INFINITY;
        const rightPrice = right.selectedPrice?.priceCents ?? Number.POSITIVE_INFINITY;
        if (leftPrice !== rightPrice) return leftPrice - rightPrice;
      }
      return countries.findIndex((country) => country.id === left.countryId) - countries.findIndex((country) => country.id === right.countryId);
    });
  }

  async function fetchCountries(state = {}, deps = {}) {
    const config = resolveConfig(state, deps);
    const payload = await fetchPayload(config, '/api/v1/countries', 'NexSMS NextAction 国家列表', {
      query: { service: config.serviceCode },
    });
    const records = Array.isArray(payload?.countries) ? payload.countries : (Array.isArray(payload) ? payload : []);
    return records.map(normalizeCountryRecord).filter(Boolean);
  }

  async function fetchServices(state = {}, deps = {}) {
    const payload = await fetchPayload(resolveConfig(state, deps), '/api/v1/services', 'NexSMS NextAction 服务列表');
    const records = Array.isArray(payload?.services) ? payload.services : (Array.isArray(payload) ? payload : []);
    return records.map((record) => {
      const code = String(record.code || record.id || record.service || '').trim();
      if (!code) return null;
      return {
        code,
        name: String(record.name || record.label || code).trim() || code,
        raw: record,
      };
    }).filter(Boolean);
  }

  async function fetchPrices(state = {}, countryConfig = null, deps = {}) {
    const config = resolveConfig(state, deps);
    const country = normalizeCountryCode(countryConfig?.id || countryConfig?.code || state.nextActionNexSmsCountryOrder?.[0] || 'US');
    const payload = await fetchPayload(config, '/api/v1/prices', 'NexSMS NextAction 价格查询', {
      query: { service: config.serviceCode, country },
    });
    return {
      country,
      prices: Array.isArray(payload?.prices) ? payload.prices.map(normalizePriceOption) : [],
      raw: payload,
    };
  }

  function collectPriceEntries(payload, entries = []) {
    if (Array.isArray(payload)) {
      payload.forEach((entry) => collectPriceEntries(entry, entries));
      return entries;
    }
    if (!payload || typeof payload !== 'object') return entries;
    if (Array.isArray(payload.prices)) {
      payload.prices.forEach((entry) => {
        const normalized = normalizePriceOption(entry);
        entries.push({
          cost: normalized.priceCents === null ? null : normalized.priceCents / 100,
          count: Number.POSITIVE_INFINITY,
          inStock: true,
          label: normalized.label,
        });
      });
    }
    return entries;
  }

  async function fetchOrder(state = {}, activation = null, deps = {}) {
    const activationId = String(activation?.activationId || '').trim();
    if (!activationId) throw new Error('缺少 NexSMS NextAction 订单 ID。');
    return fetchPayload(resolveConfig(state, deps), `/api/v1/orders/${encodeURIComponent(activationId)}`, 'NexSMS NextAction 订单详情');
  }

  async function fetchOrders(state = {}, options = {}, deps = {}) {
    const payload = await fetchPayload(resolveConfig(state, deps), '/api/v1/orders', 'NexSMS NextAction 订单列表', {
      query: {
        page: Math.max(1, Math.floor(Number(options.page) || 1)),
        page_size: Math.min(100, Math.max(1, Math.floor(Number(options.pageSize || options.page_size) || 50))),
      },
    });
    const records = Array.isArray(payload?.orders) ? payload.orders : (Array.isArray(payload) ? payload : []);
    return records.map((order) => normalizeOrder(order, { serviceCode: state.nextActionNexSmsServiceCode })).filter(Boolean);
  }

  function normalizeOrder(order = {}, fallback = {}) {
    const phoneNumber = String(order.phone_number_full || order.phone_number || order.phone_number_local || '').trim();
    const activationId = String(order.id || '').trim();
    if (!phoneNumber || !activationId) return null;
    return {
      activationId,
      phoneNumber,
      provider: PROVIDER_ID,
      serviceCode: normalizeServiceCode(order.service || fallback.serviceCode),
      countryId: normalizeCountryCode(order.country_code || fallback.countryCode),
      countryLabel: String(order.country || order.country_code || fallback.countryCode || '').trim(),
      smsUrl: String(order.sms_url || '').trim(),
      apiSmsUrl: String(order.api_sms_url || '').trim(),
      status: String(order.status || '').trim(),
      maxUses: DEFAULT_SUCCESSFUL_TASK_MAX_USES,
      canGetAnotherSms: true,
      successfulUses: 0,
    };
  }

  function parsePhoneSmsUrlCredential(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const [phonePart, urlPart] = raw.split('----');
    const phoneNumber = String(phonePart || '').trim();
    const smsUrl = String(urlPart || '').trim();
    const orderMatch = smsUrl.match(/\/api\/(?:v1\/sms-url|orders)\/([^/?#]+)(?:\/sms-url)?/i);
    const activationId = orderMatch ? decodeURIComponent(orderMatch[1]) : '';
    if (!phoneNumber || !activationId) return null;
    return {
      activationId,
      phoneNumber,
      provider: PROVIDER_ID,
      serviceCode: DEFAULT_SERVICE_CODE,
      countryId: 'US',
      countryLabel: 'US',
      smsUrl,
      maxUses: DEFAULT_SUCCESSFUL_TASK_MAX_USES,
      successfulUses: 0,
      canGetAnotherSms: true,
      source: 'nextaction-import',
    };
  }

  function isNoNumbersError(payloadOrMessage) {
    return /暂无可用|无库存|no\s+(?:stock|number)|not\s+available/i.test(describePayload(payloadOrMessage));
  }

  function isPendingMessage(payloadOrMessage) {
    const text = describePayload(payloadOrMessage);
    return /^(NO\|code|NO)$/i.test(text) || /waiting|未收到|pending/i.test(text);
  }

  function isTerminalError(payloadOrMessage, status = 0) {
    if ([401, 403].includes(Number(status))) return true;
    return /unauthorized|forbidden|余额不足|invalid|bad\s*key|wrong\s*key|订单不存在/i.test(describePayload(payloadOrMessage));
  }

  async function requestActivation(state = {}, _options = {}, deps = {}) {
    const config = resolveConfig(state, deps);
    assertValidPriceRange(config);
    let availableCountries = null;
    try {
      availableCountries = await fetchCountries(state, deps);
    } catch (error) {
      if (typeof deps.addLog === 'function') {
        await deps.addLog(`步骤 9：NexSMS NextAction 国家库存查询失败，继续按手动国家顺序尝试。${error.message}`, 'warn');
      }
    }
    const availableByCode = new Map((availableCountries || []).map((entry) => [entry.code, entry]));
    const countryCandidates = [];
    for (const country of resolveCountryCandidates(state)) {
      const liveCountry = availableByCode.get(country.id);
      if (liveCountry && !liveCountry.hasStock) {
        if (typeof deps.addLog === 'function') {
          await deps.addLog(`步骤 9：NexSMS NextAction ${liveCountry.label} 无库存，已跳过。`, 'info');
        }
        continue;
      }
      countryCandidates.push(liveCountry ? { ...country, ...liveCountry, id: liveCountry.code, label: liveCountry.label } : country);
    }

    const orderPlans = await buildOrderPlans(state, countryCandidates, config, deps);
    let lastError = null;
    for (const plan of orderPlans) {
      const country = plan.country;
      const pricingOption = normalizePricingOption(plan.selectedPrice?.pricingOption ?? config.pricingOption);
      try {
        const payload = await fetchPayload(config, '/api/v1/orders', 'NexSMS NextAction 下单', {
          method: 'POST',
          body: {
            service: config.serviceCode,
            country: country.id,
            pricing_option: pricingOption,
            quantity: 1,
          },
        });
        const order = Array.isArray(payload?.orders) ? payload.orders[0] : payload?.order;
        const activation = normalizeOrder(order || payload, {
          countryCode: country.id,
          serviceCode: config.serviceCode,
        });
        if (activation) return activation;
        lastError = new Error(`NexSMS NextAction 下单成功，但未返回手机号：${describePayload(payload)}`);
      } catch (error) {
        if (isTerminalError(error?.payload || error?.message, error?.status)) throw error;
        lastError = error;
        if (typeof deps.addLog === 'function') {
          await deps.addLog(`步骤 9：NexSMS NextAction ${country.label} 获取手机号失败：${error.message}`, 'warn');
        }
      }
    }
    throw lastError || new Error('NexSMS NextAction 获取手机号失败。');
  }

  async function reuseActivation(state = {}, activation = null, deps = {}) {
    const normalizedActivation = normalizeOrder(activation, {
      countryCode: activation?.countryId || 'US',
      serviceCode: activation?.serviceCode || DEFAULT_SERVICE_CODE,
    }) || (activation && typeof activation === 'object' ? { ...activation } : null);
    const activationId = String(normalizedActivation?.activationId || '').trim();
    if (!activationId) {
      throw new Error('缺少可复用的 NexSMS NextAction 订单 ID。');
    }
    const config = resolveConfig(state, deps);
    const detail = await fetchOrder(state, normalizedActivation, deps).catch((error) => {
      if (isTerminalError(error?.payload || error?.message, error?.status)) throw error;
      return null;
    });
    const detailOrder = detail?.order || detail;
    const detailStatus = String(detailOrder?.status || '').trim().toLowerCase();
    if (/refunded|cancelled|canceled|expired|finished|completed/.test(detailStatus)) {
      throw new Error(`NexSMS NextAction 订单当前状态不可复用：${detailStatus}`);
    }
    const payload = await fetchPayload(
      config,
      `/api/v1/orders/${encodeURIComponent(activationId)}/resend`,
      'NexSMS NextAction 重收短信',
      { method: 'POST' }
    );
    const nextOrder = payload?.order || payload;
    const nextActivation = normalizeOrder(nextOrder, {
      countryCode: normalizedActivation.countryId || 'US',
      serviceCode: normalizedActivation.serviceCode || config.serviceCode,
    }) || normalizedActivation;
    return {
      ...normalizedActivation,
      ...nextActivation,
      activationId,
      phoneNumber: nextActivation.phoneNumber || normalizedActivation.phoneNumber,
      provider: PROVIDER_ID,
      maxUses: Math.max(1, Number(normalizedActivation.maxUses) || DEFAULT_SUCCESSFUL_TASK_MAX_USES),
      successfulUses: Math.max(0, Number(normalizedActivation.successfulUses) || 0),
      canGetAnotherSms: true,
    };
  }

  async function cancelActivation(state = {}, activation = null, deps = {}) {
    const activationId = String(activation?.activationId || '').trim();
    if (!activationId) return '';
    const config = resolveConfig(state, deps);
    const smsPayload = await fetchPayload(config, `/api/v1/sms-url/${encodeURIComponent(activationId)}`, 'NexSMS NextAction 释放前短信检查', {
      query: { format: 'json' },
    }).catch(() => null);
    if (smsPayload?.received || String(smsPayload?.status || '').toUpperCase() === 'YES' || extractVerificationCode(smsPayload?.code || smsPayload?.message || describePayload(smsPayload))) {
      return 'NexSMS NextAction 已检测到短信，跳过释放。';
    }
    const payload = await fetchPayload(config, `/api/v1/orders/${encodeURIComponent(activationId)}/cancel`, 'NexSMS NextAction 释放号码', { method: 'POST' });
    return describePayload(payload);
  }

  async function requestAdditionalSms(state = {}, activation = null, deps = {}) {
    return reuseActivation(state, activation, deps);
  }

  function extractVerificationCode(rawText = '') {
    const text = String(rawText || '').trim();
    const match = text.match(/\b(\d{4,8})\b/);
    return match?.[1] || '';
  }

  async function pollActivationCode(state = {}, activation = null, options = {}, deps = {}) {
    const activationId = String(activation?.activationId || '').trim();
    if (!activationId) throw new Error('缺少 NexSMS NextAction 订单 ID。');
    const config = resolveConfig(state, deps);
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 180000);
    const intervalMs = Math.max(1000, Number(options.intervalMs) || 5000);
    const start = Date.now();
    let lastResponse = '';
    while (Date.now() - start < timeoutMs) {
      deps.throwIfStopped?.();
      const payload = await fetchPayload(config, `/api/v1/sms-url/${encodeURIComponent(activationId)}`, 'NexSMS NextAction 查询短信', {
        query: { format: 'json' },
      });
      lastResponse = describePayload(payload);
      const code = extractVerificationCode(payload?.code || payload?.message || lastResponse);
      if (payload?.received || String(payload?.status || '').toUpperCase() === 'YES' || /^YES\|/i.test(lastResponse)) {
        if (code) return code;
      }
      if (typeof options.onWaitingForCode === 'function') {
        await options.onWaitingForCode({ activation, statusText: lastResponse || 'PENDING', timeoutMs });
      }
      await deps.sleepWithStop?.(intervalMs);
    }
    throw new Error(`${PHONE_CODE_TIMEOUT_ERROR_PREFIX}等待手机验证码超时。${lastResponse ? ` NexSMS NextAction 最后状态：${lastResponse}` : ''}`);
  }

  async function fetchBalance(state = {}, deps = {}) {
    const payload = await fetchPayload(resolveConfig(state, deps), '/api/v1/profile', 'NexSMS NextAction 查询余额');
    return payload?.balance ?? payload?.balance_cents ?? describePayload(payload);
  }

  function createProvider(deps = {}) {
    const providerDeps = {
      addLog: deps.addLog || (async () => {}),
      fetchImpl: deps.fetchImpl,
      requestTimeoutMs: deps.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
      sleepWithStop: deps.sleepWithStop || (async () => {}),
      throwIfStopped: deps.throwIfStopped || (() => {}),
    };
    return {
      id: PROVIDER_ID,
      label: PROVIDER_LABEL,
      defaultServiceCode: DEFAULT_SERVICE_CODE,
      normalizeCountryOrder,
      normalizeServiceCode,
      resolveCountryCandidates,
      requestActivation: (state, options) => requestActivation(state, options, providerDeps),
      reuseActivation: (state, activation) => reuseActivation(state, activation, providerDeps),
      finishActivation: async () => 'NexSMS NextAction complete skipped',
      cancelActivation: (state, activation) => cancelActivation(state, activation, providerDeps),
      banActivation: (state, activation) => cancelActivation(state, activation, providerDeps),
      requestAdditionalSms: (state, activation) => requestAdditionalSms(state, activation, providerDeps),
      pollActivationCode: (state, activation, options) => pollActivationCode(state, activation, options, providerDeps),
      fetchBalance: (state) => fetchBalance(state, providerDeps),
      fetchServices: (state) => fetchServices(state, providerDeps),
      fetchCountries: (state) => fetchCountries(state, providerDeps),
      fetchPrices: (state, countryConfig) => fetchPrices(state, countryConfig, providerDeps),
      fetchOrder: (state, activation) => fetchOrder(state, activation, providerDeps),
      fetchOrders: (state, options) => fetchOrders(state, options, providerDeps),
      collectPriceEntries,
      parsePhoneSmsUrlCredential,
      describePayload,
      isNoNumbersError,
      isPendingMessage,
      isTerminalError,
      extractVerificationCode,
    };
  }

  return {
    PROVIDER_ID,
    PROVIDER_LABEL,
    DEFAULT_BASE_URL,
    DEFAULT_SERVICE_CODE,
    DEFAULT_COUNTRY_ORDER,
    createProvider,
    normalizeCountryOrder,
    normalizeServiceCode,
    parsePhoneSmsUrlCredential,
  };
});
