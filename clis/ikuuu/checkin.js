/**
 * iKuuu 每日签到：复用页面登录态和原有按钮，刷新后确认服务器状态。
 * 策略：UI_SELECTOR / visible-ui；#checkin-div 为语义锚点。
 * 已核对页面脚本通过 jQuery 提交 /user/checkin；仅观察自然响应，不重放接口。
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';

const DOMAIN = 'ikuuu.top';
const HOME = `https://${DOMAIN}/user`;
const UNCERTAIN = '请先在浏览器刷新首页核对今日签到状态，不要直接重试。';

/** 在浏览器内读取严格限定的签到入口，缺失入口绝不等同于已签到。 */
function readCheckinState() {
    if (/^\/auth(?:\/|$)/.test(location.pathname) || document.querySelector('input[type="password"]')) {
        return { pageKind: 'auth' };
    }
    if (/Just a moment|验证|验证码/i.test(document.title)
        || document.querySelector('iframe[src*="challenges.cloudflare.com"], .g-recaptcha, .h-captcha')) {
        return { pageKind: 'challenge' };
    }
    if (location.origin !== 'https://ikuuu.top' || !/^\/user\/?$/.test(location.pathname)) {
        return { pageKind: 'unexpected' };
    }
    const controls = [...document.querySelectorAll('#checkin-div a, #checkin-div button')];
    if (controls.length !== 1) return { pageKind: 'missing' };
    const control = controls[0];
    const label = control.textContent.replace(/\s+/g, '').trim();
    const disabled = control.classList.contains('disabled') || control.disabled || control.getAttribute('aria-disabled') === 'true';
    if (disabled && /^(明日再来|已签到|今日已签到)$/.test(label)) return { pageKind: 'done' };
    if (!disabled && label === '每日签到') return { pageKind: 'ready' };
    return { pageKind: 'missing' };
}

/** 在浏览器内观察页面自己的 AJAX 完成事件；同一文档重复求值也只点击一次。 */
async function clickAndObserveCheckin(timeoutMs, attemptId) {
    if (window.__opencliIkuuuCheckin) return window.__opencliIkuuuCheckin;
    if (location.origin !== 'https://ikuuu.top' || !/^\/user\/?$/.test(location.pathname)) {
        return { outcome: 'unexpected' };
    }
    // 页面导航会清空 window，但不会清空当前标签页的 sessionStorage。
    // 为同一次命令保留发送标记，传输层跨文档重试也不得再次点击。
    try {
        if (sessionStorage.getItem('opencli.ikuuu.checkinAttempt') === attemptId) return { outcome: 'uncertain' };
    } catch {
        return { outcome: 'storage_unavailable' };
    }
    const controls = [...document.querySelectorAll('#checkin-div a, #checkin-div button')];
    if (controls.length !== 1) return { outcome: 'missing' };
    const control = controls[0];
    const label = control.textContent.replace(/\s+/g, '').trim();
    const disabled = control.classList.contains('disabled') || control.disabled || control.getAttribute('aria-disabled') === 'true';
    if (disabled && /^(明日再来|已签到|今日已签到)$/.test(label)) return { outcome: 'already' };
    if (disabled || label !== '每日签到' || typeof window.jQuery !== 'function') return { outcome: 'missing' };

    try {
        sessionStorage.setItem('opencli.ikuuu.checkinAttempt', attemptId);
    } catch {
        return { outcome: 'storage_unavailable' };
    }

    // 先保存共享 Promise 再点击，防止浏览器传输层重试造成重复提交。
    let finish;
    window.__opencliIkuuuCheckin = new Promise(resolve => { finish = resolve; });
    const jq = window.jQuery;
    let timer;
    const complete = result => {
        clearTimeout(timer);
        jq(document).off('ajaxComplete.opencliIkuuu', onComplete);
        finish(result);
    };
    const onComplete = (_event, xhr, settings) => {
        let requestUrl;
        try {
            requestUrl = new URL(settings.url, location.href);
        } catch {
            return;
        }
        if (requestUrl.origin !== location.origin || requestUrl.pathname !== '/user/checkin'
            || String(settings.type).toUpperCase() !== 'POST') return;
        if (xhr.status === 401 || xhr.status === 403) return complete({ outcome: 'auth' });
        if (xhr.status < 200 || xhr.status >= 300) return complete({ outcome: 'http', httpCode: xhr.status });
        let payload;
        try {
            payload = xhr.responseJSON ?? JSON.parse(xhr.responseText);
        } catch {
            const loginPage = /<input\b[^>]*type\s*=\s*["']password["']/i.test(xhr.responseText ?? '');
            return complete({ outcome: loginPage ? 'auth' : 'malformed' });
        }
        if (!payload || typeof payload !== 'object' || typeof payload.msg !== 'string' || !payload.msg.trim()) {
            return complete({ outcome: 'malformed' });
        }
        // 某些主题即使业务失败也显示成功弹窗，因此不能相信弹窗图标或按钮变化。
        const rejected = payload.ret === 0 || payload.ret === '0' || payload.ret === false || payload.success === false;
        complete({ outcome: rejected ? 'rejected' : 'received', responseMessage: payload.msg.trim() });
    };
    jq(document).on('ajaxComplete.opencliIkuuu', onComplete);
    timer = setTimeout(() => complete({ outcome: 'timeout' }), timeoutMs);
    try {
        control.click();
    } catch {
        complete({ outcome: 'click_failed' });
    }
    return window.__opencliIkuuuCheckin;
}

/** 把站点页面状态转换成可供脚本判断的类型化错误。 */
function requireUsableState(state, afterSubmit = false) {
    if (state?.pageKind === 'auth') throw new AuthRequiredError(DOMAIN, afterSubmit
        ? '刷新核验时登录失效，请重新登录并先核对今日签到状态，不要直接重试。'
        : 'iKuuu 登录已失效，请先在连接 OpenCLI 的浏览器中登录。');
    if (state?.pageKind === 'challenge') throw new CommandExecutionError('iKuuu 需要人工完成验证码或访问验证。', afterSubmit ? UNCERTAIN : '请在浏览器完成验证后再运行命令。');
    if (!['done', 'ready'].includes(state?.pageKind)) {
        throw new CommandExecutionError('无法识别 iKuuu 签到入口，页面结构可能已变化。', afterSubmit ? UNCERTAIN : '请在浏览器确认已登录并能看到每日签到按钮。');
    }
}

cli({
    site: 'ikuuu',
    name: 'checkin',
    description: 'iKuuu 每日签到并领取流量奖励（需浏览器登录）',
    domain: DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    access: 'write',
    args: [],
    columns: ['status', 'message'],
    func: async (page) => {
        if (!page) throw new CommandExecutionError('iKuuu 签到需要浏览器连接。');
        await page.goto(HOME);
        const before = await page.evaluate(readCheckinState);
        requireUsableState(before);
        if (before.pageKind === 'done') return [{ status: 'already_checked_in', message: '今日已签到，明日再来。' }];

        let observed;
        try {
            // 此标识只用于标签页内防重复，不包含账号、Cookie 或其他凭据。
            const attemptId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            observed = await page.evaluate(clickAndObserveCheckin, 10_000, attemptId);
        } catch {
            throw new CommandExecutionError('签到操作中断，结果尚未确认。', UNCERTAIN);
        }
        if (observed?.outcome === 'already') return [{ status: 'already_checked_in', message: '今日已签到，明日再来。' }];
        if (observed?.outcome === 'auth') throw new AuthRequiredError(DOMAIN, '签到时登录失效，请在浏览器重新登录，并核对今日签到状态。');
        if (observed?.outcome === 'timeout') throw new TimeoutError('等待 iKuuu 签到响应', 10, UNCERTAIN);
        if (observed?.outcome !== 'received') {
            const detail = observed?.responseMessage ?? (observed?.httpCode !== undefined ? `HTTP ${observed.httpCode}` : '未收到有效签到响应');
            throw new CommandExecutionError(`iKuuu 签到未能确认：${detail}`, UNCERTAIN);
        }

        // 用全新加载的服务器页面独立核验，避免页面脚本先改按钮再报业务失败。
        let after;
        try {
            await page.goto(HOME);
            after = await page.evaluate(readCheckinState);
        } catch {
            throw new CommandExecutionError('签到响应已收到，但刷新核验失败。', UNCERTAIN);
        }
        requireUsableState(after, true);
        if (after.pageKind !== 'done') throw new CommandExecutionError('刷新后仍未显示今日已签到，无法确认签到成功。', UNCERTAIN);
        return [{ status: 'success', message: observed.responseMessage }];
    },
});
