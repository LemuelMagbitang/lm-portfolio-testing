      // catches regressions where buildProjectBody is accidentally scoped
      // inside the Main Projects renderer and becomes undefined here.
      page.once('dialog', dialog => dialog.accept('Smoke Curated-only Project'));
      await page.locator('#content [data-create]').click();
      const curatedOnlyRow = page.locator('#content [data-list] .card-item').filter({ hasText: 'Smoke Curated-only Project' }).first();
      await curatedOnlyRow.waitFor({ state: 'visible', timeout: 5000 });
      const curatedTitle = curatedOnlyRow.locator('[data-f="title"]').first();
      if (await curatedTitle.count() !== 1 || (await curatedTitle.inputValue()) !== 'Smoke Curated-only Project') {
        throw new Error('Curated Views Create Project did not mount the shared project editor.');
      }

      page.once('dialog', dialog => dialog.accept());
      await projectsNav.click();
      try {
        await page.locator('#content #projList .card-item').first().waitFor({ state: 'visible', timeout: 5000 });
      } catch (error) {
        const sectionError = await page.locator('#content [data-error-message]').textContent().catch(() => '');
        const contentText = await page.locator('#content').innerText().catch(() => '');
        throw new Error(
          `CMS Projects section failed to render: ${sectionError?.trim() || contentText?.trim() || error.message}`
        );
      }
      const curatedDirtyAfterLeave = await page.locator('#dirty-curatedViews').evaluate(el => getComputedStyle(el).display);
      if (curatedDirtyAfterLeave !== 'none') throw new Error('Curated Views dirty state leaked across CMS section navigation.');
      await projectsNav.click();
      await page.locator('#content #projList .card-item').first().waitFor({ state: 'visible', timeout: 5000 });

      const testProject = page.locator('#content #projList .card-item').filter({ hasText: 'Test Project' }).first();
      if (await testProject.count() !== 1) throw new Error('CMS Projects editor did not render the test-project fixture.');

      const projectRowsInitial = await page.locator('#content #projList .project-list-item').evaluateAll(rows =>
        rows.map(row => ({
          open: row.classList.contains('is-open'),
          bodyDisplay: getComputedStyle(row.querySelector('[data-body]')).display,
          title: row.querySelector('.item-title')?.textContent?.trim() || '',
          subtitle: row.querySelector('.project-preview-text')?.textContent?.trim() || '',
          hasPreview: !!row.querySelector('.project-collapsed-preview'),
          hasActions: !!row.querySelector('.project-card-actions')
        }))
      );
      if (!projectRowsInitial.length || projectRowsInitial.some(row => row.open || row.bodyDisplay !== 'none')) {
        throw new Error('CMS Projects tab opened a project automatically instead of showing the list closed.');
      }
      const closedProjectGeometry = await testProject.evaluate(row => {
        const head=row.querySelector('.project-card-head')?.getBoundingClientRect();
        const preview=row.querySelector('.project-collapsed-preview')?.getBoundingClientRect();
        const label=row.querySelector('.project-item-label')?.getBoundingClientRect();
        const actions=row.querySelector('.project-card-actions')?.getBoundingClientRect();
        const headStyle=row.querySelector('.project-card-head') ? getComputedStyle(row.querySelector('.project-card-head')) : null;
        const style=getComputedStyle(row);
        return {
          display:headStyle?.display || '',
          columns:headStyle?.gridTemplateColumns || '',
          row: head ? {left:head.left,right:head.right,top:head.top,bottom:head.bottom} : null,
          preview: preview ? {left:preview.left,right:preview.right,top:preview.top,bottom:preview.bottom,width:preview.width,height:preview.height} : null,
          label: label ? {left:label.left,right:label.right,top:label.top,bottom:label.bottom} : null,
          actions: actions ? {left:actions.left,right:actions.right,top:actions.top,bottom:actions.bottom} : null,
          radius: style.borderRadius
        };
      });
      if (closedProjectGeometry.display !== 'grid') {
        throw new Error('CMS collapsed Project header lost its grid presentation: '+JSON.stringify(closedProjectGeometry));
      }
      if (!closedProjectGeometry.preview || !closedProjectGeometry.label || !closedProjectGeometry.actions) {
        throw new Error('Closed CMS Project shell is missing its thumbnail, title/subtitle block, or action layer: '+JSON.stringify(closedProjectGeometry));
      }
      if (closedProjectGeometry.preview.right < closedProjectGeometry.label.right ||
          closedProjectGeometry.preview.right > closedProjectGeometry.actions.left + 6) {
        throw new Error('CMS closed Project thumbnail is not positioned to the right of the title/subtitle and immediately before the action layer: '+JSON.stringify(closedProjectGeometry));
      }
      if (closedProjectGeometry.preview.height < 50 || closedProjectGeometry.preview.width < 60) {
        throw new Error('CMS closed Project thumbnail is undersized: '+JSON.stringify(closedProjectGeometry));
      }
      if (closedProjectGeometry.radius === '0px') {
        throw new Error('CMS closed Project shell lost its rounded corner geometry.');
      }
      const sampleRow = projectRowsInitial[0];