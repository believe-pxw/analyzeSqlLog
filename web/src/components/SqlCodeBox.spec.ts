// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import SqlCodeBox from './SqlCodeBox.vue';

describe('SqlCodeBox.vue Frontend DOM Specs (select ... from 折叠/展开/复制)', () => {
  const longMultiColumnSql =
    'select OID, VerID, GroupID, CompanyCodeID, FiscalYearPeriod, Money_Debit, Money_Credit from EFI_VoucherNBalance_INCR order by GroupId';
  const compressedSql =
    'select ... from EFI_VoucherNBalance_INCR order by GroupId';

  it('1. 初始化挂载时：对于多列超长 SQL，DOM 文本必须默认渲染为折叠态 `select ... from`', () => {
    const wrapper = mount(SqlCodeBox, {
      props: {
        code: longMultiColumnSql,
      },
    });

    const text = wrapper.text().trim();
    // 必须包含折叠后的 `...`
    expect(text).toBe(compressedSql);
    expect(text).toContain('select ... from');
    expect(text).not.toContain('CompanyCodeID');
    // 严禁包含多余杂质提示文字
    expect(text).not.toContain('▼ 点击展开全部');
  });

  it('2. 左键单击第 1 次：DOM 文本必须无缝切换展开为完整多列 SQL', async () => {
    const wrapper = mount(SqlCodeBox, {
      props: {
        code: longMultiColumnSql,
      },
    });

    // 触发左键点击
    await wrapper.trigger('click');

    const expandedText = wrapper.text().trim();
    expect(expandedText).toBe(longMultiColumnSql);
    expect(expandedText).toContain('CompanyCodeID');
    expect(expandedText).toContain('Money_Debit');
    expect(wrapper.classes()).toContain('expanded');
  });

  it('3. 左键单击第 2 次：DOM 文本必须无缝恢复收起为 `select ... from`', async () => {
    const wrapper = mount(SqlCodeBox, {
      props: {
        code: longMultiColumnSql,
      },
    });

    // 第 1 次点击 -> 展开
    await wrapper.trigger('click');
    expect(wrapper.text().trim()).toBe(longMultiColumnSql);

    // 第 2 次点击 -> 收起
    await wrapper.trigger('click');
    expect(wrapper.text().trim()).toBe(compressedSql);
    expect(wrapper.classes()).not.toContain('expanded');
  });

  it('4. 普通未超长 SQL（少于5列）：初始与点击均保持原样并正确响应 expanded 类名', async () => {
    const shortSql = 'SELECT id, username FROM sys_user WHERE id = ?';
    const wrapper = mount(SqlCodeBox, {
      props: {
        code: shortSql,
      },
    });

    expect(wrapper.text().trim()).toBe(shortSql);

    await wrapper.trigger('click');
    expect(wrapper.text().trim()).toBe(shortSql);
    expect(wrapper.classes()).toContain('expanded');

    await wrapper.trigger('click');
    expect(wrapper.classes()).not.toContain('expanded');
  });

  it('5. 鼠标右键 (contextmenu)：触发复制完整未压缩 SQL，并发出 toast 事件', async () => {
    const wrapper = mount(SqlCodeBox, {
      props: {
        code: longMultiColumnSql,
      },
    });

    // 触发右键
    await wrapper.trigger('contextmenu');

    // 断言发出了 toast 事件，且事件参数正确
    expect(wrapper.emitted()).toHaveProperty('toast');
    const toastEvents = wrapper.emitted('toast');
    expect(toastEvents).toBeDefined();
    expect(toastEvents![0]).toEqual(['已复制完整 SQL 语句至剪贴板']);
  });
});
