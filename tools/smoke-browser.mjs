    await smokePage(browser, '/', async page => {
      const contact = page.locator('.nav-links a[href="#contact-start"]').first();
      if (await contact.count() !== 1) throw new Error('Works page Contact navigation link is missing.');
      await contact.click();
      await page.waitForTimeout(120);
      const box = await page.locator('#contact-section').first().boundingBox();
      const viewport = await page.evaluate(() => ({
        height: Number(window.visualViewport?.height) || Number(window.innerHeight) || 0,
        top: Number(window.visualViewport?.offsetTop) || 0
      }));
      if (!box) throw new Error('Same-page Contact navigation did not reach the Contact section.');
      const centerDelta = Math.abs((box.y + box.height / 2) - (viewport.top + viewport.height / 2));
      if (centerDelta > 32) {
        const diagnostics = await page.evaluate(() => {
          const section = document.querySelector('#contact-section');
          const scrolling = document.scrollingElement || document.documentElement;
          const rect = section?.getBoundingClientRect();
          const viewportHeight = Number(window.visualViewport?.height) || Number(window.innerHeight) || 0;
          return {
            scrollY: Number(window.scrollY) || 0,
            scrollTop: Number(scrolling?.scrollTop) || 0,
            scrollHeight: Number(scrolling?.scrollHeight) || 0,
            clientHeight: Number(scrolling?.clientHeight) || 0,
            maxScrollY: Math.max(0, Number(scrolling?.scrollHeight) - viewportHeight),
            sectionTop: Number(rect?.top) || 0,
            sectionHeight: Number(rect?.height) || 0,
            viewportHeight,
            viewportCenter: (Number(window.visualViewport?.offsetTop) || 0) + viewportHeight / 2
          };
        });
        throw new Error('Same-page Contact section is not centered: delta=' + centerDelta + ' diagnostics=' + JSON.stringify(diagnostics));
      }
      if (!(await page.evaluate(() => window.location.hash === '#contact-start'))) {
        throw new Error('Same-page Contact navigation did not preserve the exact contact-start hash.');
      }
    }, { width: 1280, height: 900 });

    await smokePage(browser, '/', async page => {
      const contact = page.locator('.nav-links a[href="#contact-start"]').first();
      if (await contact.count() !== 1) {
        throw new Error('Works page Contact navigation does not target the exact Start a Project anchor.');
      }
      await contact.click();
      await page.waitForTimeout(120);
      const box = await page.locator('#contact-section').first().boundingBox();