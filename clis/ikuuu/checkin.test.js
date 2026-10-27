import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import './checkin.js';

const command = getRegistry().get('ikuuu/checkin');
const windows = [];
const READY = '<div id="checkin-div"><a href="#" onclick="checkin()">每日签到</a></div>';
const DONE = '<div id="checkin-div"><a href="#" class="btn disabled"><i></i> 明日再来\n</a></div>';

/** 合成站点和浏览器传输层：实际执行适配器的 DOM、点击、观察与刷新代码。 */
function makePage(options = {}) {
    const clicked = vi.fn();
    const hooks = new Set();
    let dom;
    let navigations = 0;
    let replayed = false;
    const page = {
        goto: vi.fn(async () => {
            navigations++;
            if (navigations > 1 && options.refreshFails) throw new Error('连接中断');
            const attempt = dom?.window.sessionStorage.getItem('opencli.ikuuu.checkinAttempt');
            const html = navigations === 1 ? (options.html ?? READY) : (options.finalHtml ?? DONE);
            dom = new JSDOM(html, {
                url: navigations === 1 ? (options.url ?? 'https://ikuuu.top/user') : 'https://ikuuu.top/user',
                runScripts: 'outside-only',
            });
            windows.push(dom.window);
            if (attempt) dom.window.sessionStorage.setItem('opencli.ikuuu.checkinAttempt', attempt);
            hooks.clear();
            // 仅模拟网站已经使用的 jQuery 事件接口，不让测试访问外网或调用真实签到。
            dom.window.jQuery = () => ({
                on: (_event, handler) => hooks.add(handler),
                off: (_event, handler) => hooks.delete(handler),
            });
            dom.window.checkin = () => {
                clicked();
                if (options.noResponse) return;
                const xhr = {
                    status: options.httpCode ?? 200,
                    responseText: options.responseText ?? JSON.stringify(options.payload ?? { msg: '获得了 128MB 流量。', ret: 1 }),
                };
                // 模拟网站旧主题无条件先改按钮、再显示成功弹窗的行为。
                if (options.optimisticUi) dom.window.document.getElementById('checkin-div').innerHTML = '<a class="disabled">明日再来</a>';
                if (options.unrelated) {
                    for (const handler of [...hooks]) handler({}, { status: 200, responseText: '{"msg":"无关响应"}' }, { url: '/workers/get-time', type: 'GET' });
                }
                const respond = () => {
                    for (const handler of [...hooks]) handler({}, xhr, { url: '/user/checkin', type: 'POST' });
                };
                if (options.delayedResponse) dom.window.setTimeout(respond, 50);
                else respond();
            };
            dom.window.document.querySelector('#checkin-div a')?.addEventListener('click', event => {
                event.preventDefault();
                dom.window.checkin();
            });
        }),
        evaluate: vi.fn(async (fn, ...args) => {
            if (options.interrupt && fn.name === 'clickAndObserveCheckin') throw new Error('浏览器连接中断');
            const expression = `(${fn.toString()})(...${JSON.stringify(args)})`;
            const value = await dom.window.eval(expression);
            if (options.replayAfterNavigation && !replayed && fn.name === 'clickAndObserveCheckin') {
                replayed = true;
                await page.goto('https://ikuuu.top/user');
                return dom.window.eval(expression);
            }
            // 同一文档重放浏览器求值，验证共享 Promise 阻止第二次点击。
            if (options.replay && !replayed && fn.name === 'clickAndObserveCheckin') {
                replayed = true;
                expect(await dom.window.eval(expression)).toEqual(value);
            }
            return value;
        }),
    };
    return { page, clicked, hooks };
}

afterEach(() => {
    for (const window of windows.splice(0)) window.close();
    vi.useRealTimers();
});

describe('iKuuu 每日签到', () => {
    it('注册需要浏览器和登录态的写命令，输出字段固定', () => {
        expect(command).toMatchObject({ site: 'ikuuu', name: 'checkin', domain: 'ikuuu.top', browser: true, access: 'write', columns: ['status', 'message'] });
    });

    it('通过页面签到一次，保留奖励说明，并刷新服务器页面确认', async () => {
        const { page, clicked, hooks } = makePage({ replay: true, unrelated: true });
        expect(await command.func(page, {})).toEqual([{ status: 'success', message: '获得了 128MB 流量。' }]);
        expect(clicked).toHaveBeenCalledTimes(1);
        expect(page.goto.mock.calls).toEqual([['https://ikuuu.top/user'], ['https://ikuuu.top/user']]);
        expect(hooks.size).toBe(0);
    });

    it('明日再来直接返回已签到，不点击或刷新', async () => {
        const { page, clicked } = makePage({ html: DONE });
        expect(await command.func(page, {})).toEqual([{ status: 'already_checked_in', message: '今日已签到，明日再来。' }]);
        expect(clicked).not.toHaveBeenCalled();
        expect(page.goto).toHaveBeenCalledTimes(1);
    });

    it('等待异步响应完成后才刷新核验', async () => {
        vi.useFakeTimers();
        const { page, clicked, hooks } = makePage({ delayedResponse: true });
        const result = command.func(page, {});
        await vi.advanceTimersByTimeAsync(1);
        expect(page.goto).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(50);
        expect(await result).toEqual([{ status: 'success', message: '获得了 128MB 流量。' }]);
        expect(clicked).toHaveBeenCalledTimes(1);
        expect(hooks.size).toBe(0);
    });

    it('传输层跨页面导航重试求值时也不再次点击', async () => {
        const { page, clicked } = makePage({ replayAfterNavigation: true, finalHtml: READY });
        await expect(command.func(page, {})).rejects.toMatchObject({ code: 'COMMAND_EXEC', hint: expect.stringContaining('不要直接重试') });
        expect(clicked).toHaveBeenCalledTimes(1);
    });

    it.each([
        { url: 'https://ikuuu.top/auth/login', html: '<form>请登录</form>' },
        { html: '<form><input type="password"></form>' },
    ])('登录页面使用 AUTH_REQUIRED 退出，且不点击', async options => {
        const { page, clicked } = makePage(options);
        await expect(command.func(page, {})).rejects.toMatchObject({ code: 'AUTH_REQUIRED', exitCode: 77 });
        expect(clicked).not.toHaveBeenCalled();
    });

    it.each([
        '<div>页面没有签到入口</div>',
        '<div id="checkin-div"><a class="disabled">每日签到</a></div>',
        '<div id="checkin-div"><a>每日签到</a><a>每日签到</a></div>',
        '<div id="checkin-div"><a class="disabled">未知状态</a></div>',
        '<title>请完成验证码</title>',
    ])('缺失、歧义、未知状态或验证码不能冒充已签到', async html => {
        const { page, clicked } = makePage({ html });
        await expect(command.func(page, {})).rejects.toMatchObject({ code: 'COMMAND_EXEC', exitCode: 1 });
        expect(clicked).not.toHaveBeenCalled();
    });

    it('不在其他域名执行签到', async () => {
        const { page, clicked } = makePage({ url: 'https://example.com/user' });
        await expect(command.func(page, {})).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
        expect(clicked).not.toHaveBeenCalled();
    });

    it.each([401, 403])('签到响应 HTTP %s 明确要求重新登录', async httpCode => {
        const { page, clicked } = makePage({ httpCode });
        await expect(command.func(page, {})).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
        expect(clicked).toHaveBeenCalledTimes(1);
    });

    it.each([
        { httpCode: 500 },
        { httpCode: 0 },
        { payload: { msg: '签到失败', ret: 0 }, optimisticUi: true },
        { payload: { msg: '签到失败', ret: '0' }, optimisticUi: true },
        { payload: { msg: '签到失败', success: false } },
        { payload: { ret: 1 } },
        { payload: { msg: '' } },
        { payload: [] },
        { responseText: '<html>访问验证</html>' },
        { responseText: '{broken' },
    ])('HTTP、业务及响应结构失败均抛错且不重试', async options => {
        const { page, clicked } = makePage(options);
        await expect(command.func(page, {})).rejects.toMatchObject({ code: 'COMMAND_EXEC', hint: expect.stringContaining('不要直接重试') });
        expect(clicked).toHaveBeenCalledTimes(1);
        expect(page.goto).toHaveBeenCalledTimes(1);
    });

    it('XHR 重定向后返回登录 HTML 时明确要求登录', async () => {
        const { page } = makePage({ responseText: '<html><input type="password"></html>' });
        await expect(command.func(page, {})).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    });

    it('页面即时改成已签到但刷新仍未签到时拒绝返回成功', async () => {
        const { page, clicked } = makePage({ optimisticUi: true, finalHtml: READY });
        await expect(command.func(page, {})).rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('刷新后仍未显示') });
        expect(clicked).toHaveBeenCalledTimes(1);
    });

    it('刷新失败时报告结果不确定，不再次签到', async () => {
        const { page, clicked } = makePage({ refreshFails: true });
        await expect(command.func(page, {})).rejects.toMatchObject({ code: 'COMMAND_EXEC', hint: expect.stringContaining('不要直接重试') });
        expect(clicked).toHaveBeenCalledTimes(1);
    });

    it('刷新后登录失效时不返回成功', async () => {
        const { page, clicked } = makePage({ finalHtml: '<input type="password">' });
        await expect(command.func(page, {})).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
        expect(clicked).toHaveBeenCalledTimes(1);
    });

    it('等待响应超时使用 TIMEOUT，移除监听且不重复点击', async () => {
        vi.useFakeTimers();
        const { page, clicked, hooks } = makePage({ noResponse: true });
        const assertion = expect(command.func(page, {})).rejects.toMatchObject({ code: 'TIMEOUT', exitCode: 75, hint: expect.stringContaining('不要直接重试') });
        await vi.advanceTimersByTimeAsync(10_000);
        await assertion;
        expect(clicked).toHaveBeenCalledTimes(1);
        expect(hooks.size).toBe(0);
        expect(page.goto).toHaveBeenCalledTimes(1);
    });

    it('浏览器求值中断时停止，不调用第二次签到', async () => {
        const { page, clicked } = makePage({ interrupt: true });
        await expect(command.func(page, {})).rejects.toMatchObject({ code: 'COMMAND_EXEC', hint: expect.stringContaining('不要直接重试') });
        expect(clicked).not.toHaveBeenCalled();
    });

    it('浏览器未连接时明确报错', async () => {
        await expect(command.func(undefined, {})).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });
});
