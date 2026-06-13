import { describe, it } from 'mocha';
import { strict as assert } from 'assert';
import { parseWritePatent, parseWriteAny, parseWriteCommand, parseWriteIntent, slugifyPatentTitle } from '../../chat/write_paper';

describe('write_paper/slugifyPatentTitle', () => {
  it('preserves Chinese characters', () => {
    assert.equal(slugifyPatentTitle('生物质衍生路线'), '生物质衍生路线');
  });

  it('lowercases and hyphenates English', () => {
    assert.equal(
      slugifyPatentTitle('A Method for Converting Lignocellulosic Biomass'),
      'a-method-for-converting-lignocellulosic-biomass',
    );
  });

  it('replaces underscores and spaces with hyphens', () => {
    assert.equal(slugifyPatentTitle('foo_bar baz'), 'foo-bar-baz');
  });

  it('strips Windows-reserved characters', () => {
    assert.equal(slugifyPatentTitle('a:b/c\\d*e?f"g<h>i|j'), 'abcdefghij');
  });

  it('collapses repeated hyphens', () => {
    assert.equal(slugifyPatentTitle('a   ---   b'), 'a-b');
  });

  it('trims leading and trailing hyphens', () => {
    assert.equal(slugifyPatentTitle('---foo---'), 'foo');
  });

  it('caps length at 100 characters', () => {
    const long = 'a'.repeat(200);
    const slug = slugifyPatentTitle(long);
    assert.equal(slug.length, 100);
  });

  it('falls back to "patent" for an empty result', () => {
    assert.equal(slugifyPatentTitle(''), 'patent');
    assert.equal(slugifyPatentTitle('   '), 'patent');
    assert.equal(slugifyPatentTitle('////'), 'patent');
  });
});

describe('write_paper/parseWritePatent', () => {
  describe('slash form', () => {
    it('parses /patent <title> with a slugified path', () => {
      const cmd = parseWritePatent('/patent 生物质衍生路线');
      assert.ok(cmd);
      assert.equal(cmd!.title, '生物质衍生路线');
      assert.equal(cmd!.writePath, '07_Patent/生物质衍生路线.typ');
    });

    it('parses /patent with an English title and slugified path', () => {
      const cmd = parseWritePatent('/patent A Method for Biomass Conversion');
      assert.ok(cmd);
      assert.equal(cmd!.writePath, '07_Patent/a-method-for-biomass-conversion.typ');
    });

    it('returns null for /patent with no title', () => {
      assert.equal(parseWritePatent('/patent'), null);
      assert.equal(parseWritePatent('/patent   '), null);
    });
  });

  describe('Chinese natural language', () => {
    it('parses "撰写专利：生物质衍生路线"', () => {
      const cmd = parseWritePatent('撰写专利：生物质衍生路线');
      assert.ok(cmd);
      assert.equal(cmd!.title, '生物质衍生路线');
      assert.equal(cmd!.writePath, '07_Patent/生物质衍生路线.typ');
    });

    it('parses "撰写专利申请书：生物质衍生路线" (the original failing case)', () => {
      const cmd = parseWritePatent('撰写专利申请书：生物质衍生路线');
      assert.ok(cmd);
      assert.equal(cmd!.title, '生物质衍生路线');
      assert.equal(cmd!.writePath, '07_Patent/生物质衍生路线.typ');
    });

    it('parses "写专利：xxx"', () => {
      const cmd = parseWritePatent('写专利：一种新的催化剂');
      assert.ok(cmd);
      assert.equal(cmd!.title, '一种新的催化剂');
    });

    it('parses "写专利申请书 xxx" (no colon)', () => {
      const cmd = parseWritePatent('写专利申请书 一种新的催化剂');
      assert.ok(cmd);
      assert.equal(cmd!.title, '一种新的催化剂');
    });

    it('parses bare "专利：xxx"', () => {
      const cmd = parseWritePatent('专利：一种新的催化剂');
      assert.ok(cmd);
      assert.equal(cmd!.title, '一种新的催化剂');
    });

    it('parses "起草专利 xxx"', () => {
      const cmd = parseWritePatent('起草专利 一种新的催化剂');
      assert.ok(cmd);
      assert.equal(cmd!.title, '一种新的催化剂');
    });
  });

  describe('English natural language', () => {
    it('parses "write a patent: xxx"', () => {
      const cmd = parseWritePatent('write a patent: a method for biomass conversion');
      assert.ok(cmd);
      assert.equal(cmd!.title, 'a method for biomass conversion');
      assert.equal(cmd!.writePath, '07_Patent/a-method-for-biomass-conversion.typ');
    });

    it('parses "patent: xxx"', () => {
      const cmd = parseWritePatent('patent: a method for biomass conversion');
      assert.ok(cmd);
      assert.equal(cmd!.title, 'a method for biomass conversion');
    });

    it('parses "write patent: xxx"', () => {
      const cmd = parseWritePatent('write patent: a method for biomass conversion');
      assert.ok(cmd);
      assert.equal(cmd!.title, 'a method for biomass conversion');
    });
  });

  describe('rejections', () => {
    it('returns null for plain text', () => {
      assert.equal(parseWritePatent('生物质衍生路线'), null);
    });

    it('returns null for an empty string', () => {
      assert.equal(parseWritePatent(''), null);
      assert.equal(parseWritePatent('   '), null);
    });

    it('returns null for "撰写专利" with no title', () => {
      assert.equal(parseWritePatent('撰写专利'), null);
      assert.equal(parseWritePatent('撰写专利申请书'), null);
    });
  });
});

describe('write_paper/parseWriteAny', () => {
  it('routes Chinese patent requests to patent', () => {
    const r = parseWriteAny('撰写专利申请书：生物质衍生路线');
    assert.ok(r);
    assert.equal(r!.type, 'patent');
    assert.equal(r!.cmd.title, '生物质衍生路线');
    assert.equal(r!.cmd.writePath, '07_Patent/生物质衍生路线.typ');
  });

  it('routes /patent slash form to patent', () => {
    const r = parseWriteAny('/patent 生物质衍生路线');
    assert.ok(r);
    assert.equal(r!.type, 'patent');
  });

  it('routes English patent requests to patent', () => {
    const r = parseWriteAny('write a patent: a method for biomass conversion');
    assert.ok(r);
    assert.equal(r!.type, 'patent');
  });

  it('routes write paper requests to paper', () => {
    const r = parseWriteAny('write paper: biomass conversion methods');
    assert.ok(r);
    assert.equal(r!.type, 'paper');
  });

  it('returns null for plain text', () => {
    assert.equal(parseWriteAny('hello world'), null);
  });
});

describe('write_paper/parseWriteCommand (slugified writePath)', () => {
  it('English title becomes slug', () => {
    const cmd = parseWriteCommand('write paper: Deep Test');
    assert.ok(cmd);
    assert.equal(cmd!.title, 'Deep Test');
    assert.equal(cmd!.phase, '05_Deliver');
    assert.equal(cmd!.writePath, '05_Deliver/deep-test.typ');
  });

  it('Chinese title is preserved in slug', () => {
    const cmd = parseWriteCommand('写论文：机器学习综述');
    assert.ok(cmd);
    assert.equal(cmd!.writePath, '05_Deliver/机器学习综述.typ');
  });

  it('respects refer research phase', () => {
    const cmd = parseWriteCommand('write paper: GDL, refer research 03_Analyze');
    assert.ok(cmd);
    assert.equal(cmd!.writePath, '03_Analyze/gdl.typ');
  });

  it('mixed punctuation is stripped from slug', () => {
    const cmd = parseWriteCommand('write paper: Hierarchical Porosity: GDL / Design');
    assert.ok(cmd);
    assert.equal(cmd!.writePath, '05_Deliver/hierarchical-porosity-gdl-design.typ');
  });

  it('two papers with different titles no longer collide', () => {
    const a = parseWriteCommand('write paper: alpha');
    const b = parseWriteCommand('write paper: beta');
    assert.ok(a && b);
    assert.notEqual(a!.writePath, b!.writePath);
  });
});

describe('write_paper/parseWriteCommand (permissive forms)', () => {
  it('parses "write a paper: <title>" with article', () => {
    const cmd = parseWriteCommand('write a paper: Zinc-Air Battery GDL');
    assert.ok(cmd);
    assert.equal(cmd!.title, 'Zinc-Air Battery GDL');
    assert.equal(cmd!.writePath, '05_Deliver/zinc-air-battery-gdl.typ');
  });

  it('parses "write the paper: <title>" with definite article', () => {
    const cmd = parseWriteCommand('write the paper: Hierarchical Porosity');
    assert.ok(cmd);
    assert.equal(cmd!.title, 'Hierarchical Porosity');
  });

  it('parses "write paper on <topic>" with explicit preposition', () => {
    const cmd = parseWriteCommand('write paper on blockchain scalability');
    assert.ok(cmd);
    assert.equal(cmd!.title, 'blockchain scalability');
  });

  it('parses "write a paper about <topic>"', () => {
    const cmd = parseWriteCommand('write a paper about zk-rollups');
    assert.ok(cmd);
    assert.equal(cmd!.title, 'zk-rollups');
  });

  it('parses "write the paper regarding <topic>"', () => {
    const cmd = parseWriteCommand('write the paper regarding layer 2 solutions');
    assert.ok(cmd);
    assert.equal(cmd!.title, 'layer 2 solutions');
  });

  it('parses "write paper, <topic>" with comma separator', () => {
    const cmd = parseWriteCommand('write paper, biomass conversion methods');
    assert.ok(cmd);
    assert.equal(cmd!.title, 'biomass conversion methods');
  });

  it('parses "write it as paper <topic>"', () => {
    const cmd = parseWriteCommand('write it as paper drone frame analysis');
    assert.ok(cmd);
    assert.equal(cmd!.title, 'drone frame analysis');
  });

  it('parses "write a paper covering <topic>"', () => {
    const cmd = parseWriteCommand('write a paper covering fuel cell degradation');
    assert.ok(cmd);
    assert.equal(cmd!.title, 'fuel cell degradation');
  });

  it('parses Chinese "写一篇论文：<title>" with measure word', () => {
    const cmd = parseWriteCommand('写一篇论文：分级孔隙气体扩散层设计');
    assert.ok(cmd);
    assert.equal(cmd!.title, '分级孔隙气体扩散层设计');
  });

  it('parses Chinese "写个论文：<title>" with colloquial measure', () => {
    const cmd = parseWriteCommand('写个论文：机器学习综述');
    assert.ok(cmd);
    assert.equal(cmd!.title, '机器学习综述');
  });

  it('parses Chinese "请写论文：<title>" with politeness prefix', () => {
    const cmd = parseWriteCommand('请写论文：锌空气电池');
    assert.ok(cmd);
    assert.equal(cmd!.title, '锌空气电池');
  });

  it('parses Chinese "把它写成论文：<title>" with 把-construction', () => {
    const cmd = parseWriteCommand('把它写成论文：区块链扩展性');
    assert.ok(cmd);
    assert.equal(cmd!.title, '区块链扩展性');
  });

  it('still rejects bare "write as paper" with no title (too ambiguous)', () => {
    assert.strictEqual(parseWriteCommand('write as paper'), null);
  });

  it('still rejects bare "write the paper" with no title', () => {
    assert.strictEqual(parseWriteCommand('write the paper'), null);
  });

  it('still rejects bare "write paper GDL" with no separator (existing contract)', () => {
    assert.strictEqual(parseWriteCommand('write paper GDL'), null);
  });

  it('still rejects bare "写论文 GDL" with no separator (existing contract)', () => {
    assert.strictEqual(parseWriteCommand('写论文 GDL'), null);
  });

  it('still rejects "write paper" with no title and no separator', () => {
    assert.strictEqual(parseWriteCommand('write paper'), null);
    assert.strictEqual(parseWriteCommand('write a paper'), null);
    assert.strictEqual(parseWriteCommand('写论文'), null);
  });

  it('permits preposition form with "refer research" phase override', () => {
    const cmd = parseWriteCommand('write paper on GDL design, refer research 04_Synthesize');
    assert.ok(cmd);
    assert.equal(cmd!.title, 'GDL design');
    assert.equal(cmd!.phase, '04_Synthesize');
    assert.equal(cmd!.writePath, '04_Synthesize/gdl-design.typ');
  });
});

describe('write_paper/parseWriteIntent', () => {
  describe('match cases (existing behavior preserved)', () => {
    it('returns match for "write paper: <title>"', () => {
      const r = parseWriteIntent('write paper: GDL');
      assert.ok(r);
      assert.equal(r!.kind, 'match');
      if (r!.kind === 'match') {
        assert.equal(r.type, 'paper');
        assert.equal(r.cmd.title, 'GDL');
      }
    });

    it('returns match for "写论文：<title>"', () => {
      const r = parseWriteIntent('写论文：机器学习综述');
      assert.ok(r);
      assert.equal(r!.kind, 'match');
      if (r!.kind === 'match') {
        assert.equal(r.type, 'paper');
      }
    });

    it('returns match for /patent <title> as patent type', () => {
      const r = parseWriteIntent('/patent A Method for Biomass Conversion');
      assert.ok(r);
      assert.equal(r!.kind, 'match');
      if (r!.kind === 'match') {
        assert.equal(r.type, 'patent');
        assert.equal(r.cmd.phase, '07_Patent');
      }
    });
  });

  describe('needs-topic cases (bare forms)', () => {
    it('flags bare "write paper" as needs-topic paper', () => {
      const r = parseWriteIntent('write paper');
      assert.ok(r);
      assert.equal(r!.kind, 'needs-topic');
      if (r!.kind === 'needs-topic') {
        assert.equal(r.type, 'paper');
      }
    });

    it('flags bare "write a paper" as needs-topic paper', () => {
      const r = parseWriteIntent('write a paper');
      assert.ok(r);
      assert.equal(r!.kind, 'needs-topic');
    });

    it('flags bare "write the paper" as needs-topic paper', () => {
      const r = parseWriteIntent('write the paper');
      assert.ok(r);
      assert.equal(r!.kind, 'needs-topic');
    });

    it('flags bare "write as paper" as needs-topic paper', () => {
      const r = parseWriteIntent('write as paper');
      assert.ok(r);
      assert.equal(r!.kind, 'needs-topic');
      if (r!.kind === 'needs-topic') {
        assert.equal(r.type, 'paper');
      }
    });

    it('flags "write it as a paper" as needs-topic paper', () => {
      const r = parseWriteIntent('write it as a paper');
      assert.ok(r);
      assert.equal(r!.kind, 'needs-topic');
    });

    it('flags "write paper on" (preposition with no topic) as needs-topic', () => {
      const r = parseWriteIntent('write paper on');
      assert.ok(r);
      assert.equal(r!.kind, 'needs-topic');
    });

    it('flags "写论文" as needs-topic paper', () => {
      const r = parseWriteIntent('写论文');
      assert.ok(r);
      assert.equal(r!.kind, 'needs-topic');
      if (r!.kind === 'needs-topic') {
        assert.equal(r.type, 'paper');
      }
    });

    it('flags "写论文：" (colon with empty title) as needs-topic paper', () => {
      const r = parseWriteIntent('写论文：');
      assert.ok(r);
      assert.equal(r!.kind, 'needs-topic');
    });

    it('flags "请写论文" as needs-topic paper', () => {
      const r = parseWriteIntent('请写论文');
      assert.ok(r);
      assert.equal(r!.kind, 'needs-topic');
    });

    it('flags bare "write patent" as needs-topic patent', () => {
      const r = parseWriteIntent('write patent');
      assert.ok(r);
      assert.equal(r!.kind, 'needs-topic');
      if (r!.kind === 'needs-topic') {
        assert.equal(r.type, 'patent');
      }
    });

    it('flags bare "撰写专利" as needs-topic patent', () => {
      const r = parseWriteIntent('撰写专利');
      assert.ok(r);
      assert.equal(r!.kind, 'needs-topic');
      if (r!.kind === 'needs-topic') {
        assert.equal(r.type, 'patent');
      }
    });
  });

  describe('null cases (not a write request)', () => {
    it('returns null for plain chat text', () => {
      assert.equal(parseWriteIntent('hello world'), null);
    });

    it('returns null for empty string', () => {
      assert.equal(parseWriteIntent(''), null);
      assert.equal(parseWriteIntent('   '), null);
    });

    it('returns null for unrelated technical question', () => {
      assert.equal(parseWriteIntent('what is the difference between L1 and L2 cache?'), null);
    });
  });
});
