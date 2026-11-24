// 1.124.9: the agent, model and effort are one chip (#c-model) and one panel (.model-sheet). These drive it in the browser
// tests, where each used to click its own chip (#c-model, #c-eff) and the setup card's agent list (#apick).
export function modelPanel(page) {
  const gone = () => page.waitForFunction(() => !document.querySelector('.model-sheet'), { timeout: 5000 }).catch(() => { });
  return {
    async open() { if (!await page.$('.model-sheet')) await page.click('#c-model'); await page.waitForSelector('.model-sheet .mp-models'); },
    async close() { if (await page.$('.model-sheet')) await page.click('.model-sheet .model-done'); await gone(); },
    // the effort levels offered for the picked model ([] when it has none), the models, and the picks
    async efforts() { await this.open(); return page.$$eval('.model-sheet [data-effort]', es => es.map(e => e.dataset.effort)); },
    async models() { await this.open(); return page.$$eval('.model-sheet .mp-models .opt', es => es.map(e => e.dataset.v)); },
    async modelRows() { await this.open(); return page.$$eval('.model-sheet .mp-models .opt', es => es.map(e => e.innerText.replace(/\s*\n\s*/g, ' | '))); },
    async effortNote() { await this.open(); return page.$eval('.model-sheet .mp-effort-note', e => e.textContent); },
    async chosen() {
      await this.open();
      return page.evaluate(() => ({ agent: document.querySelector('.model-sheet [data-agent][aria-checked="true"]')?.dataset.agent || null,
        model: document.querySelector('.model-sheet .mp-models .opt.sel')?.dataset.v || null,
        effort: document.querySelector('.model-sheet [data-effort][aria-checked="true"]')?.dataset.effort || null }));
    },
    async agents() { await this.open(); return page.$$eval('.model-sheet [data-agent]', es => es.map(e => e.dataset.agent)); },
    async agent(a) { await this.open(); await page.click(`.model-sheet [data-agent="${a}"]`); await page.waitForSelector(`.model-sheet [data-agent="${a}"][aria-checked="true"]`); await this.close(); },
    async model(v) { await this.open(); await page.click(`.model-sheet .mp-models .opt[data-v="${v}"]`); await page.waitForSelector(`.model-sheet .mp-models .opt.sel[data-v="${v}"]`); await this.close(); },
    async effort(v) { await this.open(); await page.click(`.model-sheet [data-effort="${v}"]`); await page.waitForSelector(`.model-sheet [data-effort="${v}"][aria-checked="true"]`); await this.close(); },
    chip: () => page.$eval('#c-model', e => e.textContent.trim()),
  };
}
