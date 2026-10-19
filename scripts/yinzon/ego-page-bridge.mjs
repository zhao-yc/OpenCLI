import fs from 'node:fs/promises';
const journalPath = new URL('../../.local/verification/unicloud-live-journal.jsonl', import.meta.url);

/** 把每次写入的意图和结果落为检查点，不记录认证或页面完整内容。 */
async function checkpoint(record) {
    await fs.mkdir(new URL('.', journalPath), { recursive: true });
    await fs.appendFile(journalPath, JSON.stringify({ time: new Date().toISOString(), ...record }) + '\n');
}

/** 将现有 ego 页面接入适配器；写入只发送一次原生 CDP，不进行代码重试。 */
export function bridge(page, spaceId) {
    return {
        goto: url => page.goto(url),
        evaluate: code => page.evaluate(code),
        wait: options => page.waitForTimeout(options.time * 1000),
        evaluateOnce: async code => {
            const stage = code.includes('function inspectPaymentDOM') ? '免费订单确认' : '创建免费订单';
            // 在确认前只读保存最小付款页样本及订单字段，供脱敏后的回归测试使用。
            if (stage === '免费订单确认') {
                const sample = await page.evaluate(() => {
                    const root = document.querySelector('.pc-pay');
                    if (!root) return null;
                    let component = root.__vueParentComponent; let vm;
                    for (let i = 0; component && i < 30; i++, component = component.parent) {
                        if (component.proxy?.orderInfo && component.proxy?.uniPay) { vm = component.proxy; break; }
                    }
                    if (!vm) return null;
                    const node = document.createElement('main'); node.className = 'pc-pay';
                    const content = document.createElement('div'); content.className = 'pc-pay-order-detial-content';
                    for (const el of root.querySelectorAll('.pc-pay-order-detial-content .content-item-latest')) content.append(el.cloneNode(true));
                    node.append(content);
                    for (const el of root.querySelectorAll('.pc-pay-order-detial-code-info-subtitle,uni-button.order-btn,button.order-btn')) node.append(el.cloneNode(true));
                    const info = vm.orderInfo; const d = info.expand_info;
                    return { html: node.outerHTML, state: { complete: vm.complete, uniPay: { loading: vm.uniPay.loading, order_id: vm.uniPay.order_id }, orderInfo: {
                        product_code: info.product_code, real_amount: info.real_amount, total_amount: info.total_amount,
                        skuInfo: { version: { value: info.skuInfo?.version?.value } },
                        expand_info: { buyType: d.buyType, businessType: d.businessType, provider: d.provider, duration: d.duration, spaceId: d.spaceId, spaceName: d.spaceName },
                    } } };
                });
                if (sample) {
                    await fs.mkdir(new URL('.', journalPath), { recursive: true });
                    await fs.writeFile(new URL('free-confirmation-sample.json', journalPath), JSON.stringify(sample, null, 2));
                }
            }
            await checkpoint({ spaceId, stage, event: '发送前' });
            try {
                const receipt = await page.cdp('Runtime.evaluate', { expression: code, returnByValue: true, awaitPromise: true }, { timeout: 15000 });
                if (receipt.exceptionDetails) throw new Error(receipt.exceptionDetails.text ?? '页面执行异常');
                const result = receipt.result?.value;
                await checkpoint({ spaceId, stage, event: '收到结果', result });
                console.log({步骤:stage,结果:result});
                return result;
            } catch (error) {
                await checkpoint({ spaceId, stage, event: '结果未确认', message: error.message });
                throw error;
            }
        },
    };
}
