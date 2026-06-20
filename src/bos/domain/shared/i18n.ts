import i18next from 'i18next';

export type Language = 'zh' | 'en';

let initialized = false;
let currentLang: Language = 'zh';

const resources = {
  en: {
    translation: {
      // Stage labels
      'stage.infancy': 'Infancy',
      'stage.growth': 'Growth',
      'stage.maturity': 'Maturity',
      'stage.decline': 'Decline',

      // Stage descriptions
      'stageDesc.infancy': 'Early R&D phase. Slow progress, high investment, many dead ends. Focus on fundamental research.',
      'stageDesc.growth': 'Rapid improvement phase. Breakthroughs accelerate. Heavy investment pays off. Market adoption increases.',
      'stageDesc.maturity': 'Diminishing returns. Most easy problems solved. Incremental improvements only. Focus on cost reduction.',
      'stageDesc.decline': 'Technology being replaced. New S-curve emerging. Divest and transition to next-generation technology.',

      // Stage strategies
      'stageStrategy.infancy': 'Invest in fundamental research. Protect IP. Explore multiple approaches. Accept high failure rate.',
      'stageStrategy.growth': 'Accelerate development. Scale production. Build market position. Patent aggressively.',
      'stageStrategy.maturity': 'Optimize for cost and reliability. Extract maximum value. Begin investing in next-generation technology.',
      'stageStrategy.decline': 'Phase out investment. Migrate customers to S2 technology. Harvest remaining profits. Divest assets.',

      // TRL titles
      'trl.1': 'Basic Principles Observed',
      'trl.2': 'Technology Concept Formulated',
      'trl.3': 'Experimental Proof of Concept',
      'trl.4': 'Component Validation in Laboratory',
      'trl.5': 'Component Validation in Relevant Environment',
      'trl.6': 'System/Subsystem Model in Relevant Environment',
      'trl.7': 'System Prototype in Operational Environment',
      'trl.8': 'Actual System Completed and Qualified',
      'trl.9': 'Actual System Proven in Operational Environment',

      // TRL descriptions
      'trlDesc.1': 'Basic principles observed and reported. Scientific research begins to be translated into applied research.',
      'trlDesc.2': 'Technology concept and/or application formulated. Invention begins, but no proof available.',
      'trlDesc.3': 'Active R&D initiated. Analytical and experimental proof of concept obtained.',
      'trlDesc.4': 'Component and/or breadboard validation in laboratory environment.',
      'trlDesc.5': 'Component validation in relevant environment. Significantly increases fidelity.',
      'trlDesc.6': 'System/subsystem model or prototype demonstration in relevant environment.',
      'trlDesc.7': 'System prototype demonstration in operational environment.',
      'trlDesc.8': 'Actual system completed and qualified through test and demonstration.',
      'trlDesc.9': 'Actual system proven through successful mission operations in routine use.',

      // Milestone labels
      'milestone.invention': 'Invention',
      'milestone.breakthrough': 'Breakthrough',
      'milestone.commercialization': 'Commercialization',
      'milestone.standardization': 'Standardization',
      'milestone.peak': 'Peak',
      'milestone.decline': 'Decline',

      // SVG labels
      'svg.inflectionPoint': 'Inflection Point',
      'svg.crossover': 'S1/S2 Crossover',
      'svg.s1Peak': 'S1 Peak',
      'svg.timeAxis': 'Time (Year)',
      'svg.s1Current': 'S1: Current Technology',
      'svg.s2Next': 'S2: Next Generation',
      'svg.realData': 'Real Data Points',
      'svg.analysisSummary': 'Analysis Summary',
      'svg.strategy': 'Strategy',
      'svg.keyEvents': 'Key Events',
      'svg.scurveAnalysis': 'S-Curve Analysis',
      'svg.currentStage': 'Current Stage',
      'svg.s2Stage': 'S2 Stage',
      'svg.crossoverYear': 'Crossover Year',
      'svg.maxS1': 'Max S1',
      'svg.maxS2': 'Max S2',

      // Report labels
      'report.title': 'TRIZ Research Report',
      'report.problem': 'Problem',
      'report.date': 'Date',
      'report.executiveSummary': 'Executive Summary',
      'report.priorArtAnalysis': 'Prior Art Analysis',
      'report.patentLandscape': 'Patent Landscape',
      'report.academicResearch': 'Academic Research',
      'report.techSolutions': 'Technical Solutions',
      'report.keyInsight': 'Key Insight',
      'report.contradictionAnalysis': 'Contradiction Analysis',
      'report.improvingParameter': 'Improving Parameter',
      'report.worseningParameter': 'Worsening Parameter',
      'report.recommendedPrinciples': 'Recommended Principles',
      'report.technologyMaturity': 'Technology Maturity Assessment',
      'report.summary': 'Summary',
      'report.currentTechnology': 'Current Technology (S1)',
      'report.nextGenTechnology': 'Next-Generation Technology (S2)',
      'report.strategicWarning': 'Strategic Warning',
      'report.criticalAlert': 'Critical Alert',
      'report.recommendations': 'Recommendations',
      'report.immediateActions': 'Immediate Actions',
      'report.researchPriorities': 'Research Priorities',
      'report.analysisErrors': 'Analysis Errors & Warnings',
      'report.metadata': 'Research Metadata',
      'report.duration': 'Duration',
      'report.sourcesUsed': 'Sources Used',
      'report.aiCalls': 'AI Calls Made',
      'report.errors': 'Errors',
      'report.sCurveStage': 'S-Curve Stage',
      'report.trl': 'Technology Readiness Level',
      'report.confidence': 'Confidence',
      'report.dataPoints': 'Data Points',
      'report.estimated': 'estimated',
      'report.real': 'real',
      'report.metric': 'Metric',
      'report.value': 'Value',
      'report.sCurveCrossover': 'S-Curve Crossover',
      'report.scurveVisualization': 'S-Curve Visualization',
      'report.keyEventsMilestones': 'Key Events & Milestones',
      'report.year': 'Year',
      'report.event': 'Event',
      'report.type': 'Type',
      'report.aiEstimate': 'AI estimate',
      'report.aiEstimatedData': 'AI-estimated data',
      'report.strategy': 'Strategy',
      'report.patentLandscapeSummary': 'The patent landscape reveals',
      'report.keyPlayers': 'Key players include',
      'report.patentsSpan': 'The patents span from',
      'report.indicating': 'indicating',
      'report.academicSummary': 'Academic research provides',
      'report.recentWork': 'Recent work by',
      'report.demonstrates': 'demonstrates',
      'report.techSolutionSummary': 'practical implementations demonstrate',
      'report.show': 'These solutions show',
      'report.maturityHigh': 'a highly mature technology with proven commercial viability. Focus should shift to optimization and cost reduction.',
      'report.maturityMid': 'a technology approaching commercial readiness. Accelerate validation and prepare for market entry.',
      'report.maturityLow': 'a technology in active development with promising prospects. Continue prototyping and seek partnerships.',
      'report.maturityEarly': 'an emerging technology with high potential but significant development risk. Invest in fundamental research.',
      'report.strategyInvest': 'Invest in fundamental research. Explore multiple approaches. Protect IP. Accept high failure rate.',
      'report.strategyAccelerate': 'Accelerate development. Scale production. Build market position. Patent aggressively.',
      'report.strategyOptimize': 'Optimize for cost and reliability. Extract maximum value. Begin investing in next-generation technology.',
      'report.strategyPhaseOut': 'Phase out investment. Migrate customers to next-generation technology. Harvest remaining profits.',
      'report.years': 'years',
      'report.willSurpass': 'The next-generation technology will surpass current performance in',
      'report.beginInvesting': 'Begin investing in S2 technology now to maintain competitive advantage.',
      'report.hasSurpassed': 'The next-generation technology has already surpassed current performance.',
      'report.immediateTransition': 'Immediate transition to S2 is required.',
      'report.svgChart': 'SVG Chart',
      'report.asciiPreview': 'ASCII Preview',
      'report.applyPrinciple': 'Apply TRIZ Principle',
      'report.reviewPatents': 'Review the',
      'report.identifiedPatents': 'identified patents to map the competitive landscape and identify white space opportunities.',
      'report.studyPapers': 'Study the',
      'report.academicPapers': 'academic papers to understand the theoretical basis for potential solutions.',
      'report.techRoadmap': 'Based on the S-curve analysis, develop a technology transition plan that balances S1 optimization with S2 investment.',
      'report.searchKeywords': 'Search Keywords',
      'report.patents': 'Patents',
      'report.academicPapersTitle': 'Academic Papers',
      'report.technicalSolutions': 'Technical Solutions',
      'report.trizContradictionAnalysis': 'TRIZ Contradiction Analysis',
      'report.improving': 'Improving',
      'report.worsening': 'Worsening',
      'report.nextGenTRL': 'Next-Gen TRL',
      'report.crossover': 'Crossover',
      'report.scurveChart': 'S-Curve Chart',
      'report.scurvePreview': 'S-Curve Preview',
      'report.noRecommendations': 'No specific recommendations available. Review prior art for insights.',
      'report.urgent': 'URGENT',
      'report.opportunity': 'OPPORTUNITY',
      'report.earlyStage': 'EARLY STAGE',
      'report.surpassByYear': 'The next S-curve will surpass current performance by year',
      'report.beginTransitioning': 'Begin transitioning resources to S2 technology immediately.',
      'report.continueInvesting': 'Continue investing in S1 while starting exploratory R&D for S2.',
      'report.focusResearch': 'Focus on fundamental research and IP protection.',
      'report.s1CurrentTech': 'S1: Current Technology',
      'report.s2NextGenTech': 'S2: Next Generation Technology',
      'report.strategicInsight': 'Strategic Insight',
      'report.trlReconciliation': 'TRL Reconciliation',
      'report.inYears': 'in',
      'report.yearsAgo': 'years ago',
      'report.performanceGap': 'Performance Gap',
      'report.higherThanS1': 'higher than S1',
      'report.predictedIn': 'S2 crossover predicted in',
      'report.exceedAround': 'S2 performance will exceed S1 around year',
      'report.reducingCosts': 'Reduce costs and resource consumption',
      'report.eliminatingHarms': 'Eliminate harms and negative side effects',
      'report.increasingBenefits': 'Increase useful functions and benefits',
      'report.considerPrinciples': 'Consider applying inventive principles to further improve',
      'report.perfectIdeality': 'No costs or harms detected — confirm this represents the ideal final state of the system',
      'report.patentTrendGrowing': 'growing patent activity in this domain',
      'report.patentTrendMature': 'a mature and stable patent landscape',
      'report.patentTrendEmerging': 'an emerging technology space',
      'report.patentInsight': 'These patents demonstrate multiple approaches to addressing similar technical challenges. Analyze the claims to understand protection scope and identify design-around opportunities.',
      'report.researchTrend': 'growing academic interest in this domain with practical applications emerging',
      'report.researchInsight': 'These papers provide theoretical foundations and experimental validation for potential solutions. Focus on papers with high citation counts for the most impactful research.',
      'report.techSolutionTrend': 'practical implementations are becoming more sophisticated and commercially viable',
      'report.techSolutionInsight': 'These solutions demonstrate practical implementations of TRIZ principles in real-world applications. Study them for proven approaches that can be adapted to your specific context.',
      'report.applyTrizPrinciples': 'Apply TRIZ principles',
      'report.reviewRelevantPatents': 'Review',
      'report.relevantPatents': 'relevant patents to understand the competitive landscape',
      'report.studyRelevantPapers': 'Study',
      'report.relevantPapers': 'relevant papers to understand the theoretical basis',
      'report.techMature': 'Technology is mature. Focus on optimization and cost reduction.',
      'report.techDeveloping': 'Technology is developing. Accelerate development and patent filing.',
      'report.techEarly': 'Technology is in early stage. Invest in fundamental research.',
      'report.monitorS2': 'Monitor S2 curve development. Currently in',
      'report.stage': 'stage. Start exploratory R&D for next-generation technology.',
      'report.criticalS2': 'Critical: The S2 curve (',
      'report.nextGen': 'next-gen) is in',
      'report.stageTransition': 'stage. Begin transitioning resources to S2 technology immediately.',
      'report.description': 'Description',
      'report.growthRate': 'Growth Rate',
      'report.inflectionPoint': 'Inflection Point',
      'report.mostLikely': 'most likely',
      'report.userProvided': 'user-provided',
      'report.yourTech': 'Your technology',
      'report.isInStage': 'is in the',
      'report.found': 'found',
      'report.authors': 'Authors',
      'report.source': 'Source',
      'report.reasoning': 'Reasoning',
      'report.analysisQuality': 'Analysis Quality',
      'report.warnings': 'warnings',
      'report.reviewErrors': 'Review errors section for details.',
      'report.keyInsights': 'Key Insights',
      'report.recommendedApproach': 'Recommended Approach',
      'report.supportingPriorArt': 'Supporting prior art',
      'report.relatedWork': 'Related work',
      'report.solutionPath': 'Solution Path',
      'report.references': 'References',
      'report.relevance': 'Relevance',
      'report.keyFindings': 'Key Findings',
      'report.principles': 'Principles',
      'report.acceleratePrototyping': 'Accelerate prototyping and validation',
      'report.investResearch': 'Invest in fundamental research',
      'report.patentQueryEn': 'Patent (EN)',
      'report.patentQueryZh': 'Patent (ZH)',
      'report.paperQueryEn': 'Paper (EN)',
      'report.paperQueryZh': 'Paper (ZH)',
      'report.techQueryEn': 'Tech (EN)',
      'report.techQueryZh': 'Tech (ZH)',
      'report.typePatent': 'Patent',
      'report.typePaper': 'Paper',
      'report.typeTech': 'Tech',
      'report.categoryPatents': 'Patents',
      'report.categoryAcademicPapers': 'Academic Papers',
      'report.summaryNotAvailable': 'Not available',
      'report.methodologyTitle': 'Methodology',
      'report.researchMetadata': 'Research Metadata',
      'report.cacheHits': 'Cache hits',
      'report.cacheMisses': 'Cache misses',

      // Progress messages
      'progress.extractingKeywords': 'AI is extracting optimized search keyword...',
      'progress.searching': 'Searching patent, papers, and technical solutions...',
      'progress.foundResults': 'Found',
      'progress.patents': 'patents',
      'progress.papers': 'papers',
      'progress.techSolutions': 'tech solutions',
      'progress.analyzingSummarizing': 'AI is analyzing and summarizing each result...',
      'progress.summarizationComplete': 'Summarization complete',
      'progress.extractingTRIZ': 'AI is extracting TRIZ parameters and analyzing contradictions...',
      'progress.extracted': 'Extracted',
      'progress.runningTRIZ': 'Running TRIZ contradiction matrix lookup, S-curve analysis, and TRL assessment...',
      'progress.trizComplete': 'TRIZ analysis complete',
      'progress.principles': 'principles',
      'progress.lookingUpMatrix': 'Looking up matrix',
      'progress.foundPrinciples': 'Found',
      'progress.couldNotResolve': 'Could not resolve',
      'progress.searchFailed': 'Search failed',
      'progress.callingTool': 'Calling tool',
      'progress.extractingSCurve': 'Extracting S-curve data',
      'progress.dataPoints': 'Data points',
      'progress.fittingCurve': 'Fitting logistic curve and detecting stage...',
      'progress.stage': 'stage',
      'progress.crossover': 'crossover',
      'progress.svgSaved': 'SVG saved to',
      'progress.contradictionFailed': 'Contradiction analysis failed',
      'progress.sCurveFailed': 'S-curve/TRL analysis failed',
      'progress.noRealData': 'No real S-curve data found. Using AI-estimated data points. Results are approximate.',
      'progress.failedInit': 'Failed to initialize AI agent',
      'progress.failedParse': 'Failed to parse AI analysis response as JSON',
'progress.failedSearch': 'No prior art found. Results may be less reliable.',
      'progress.failedAnalyze': 'AI analysis failed',
      'progress.summarizingResults': 'Summarizing search results for the report...',
      'report.noReportGenerated': 'Research did not produce a valid report. Check error details.',
      'progress.failedTRIZ': 'TRIZ analysis failed',
    },
  },
  zh: {
    translation: {
      // Stage labels
      'stage.infancy': '萌芽期',
      'stage.growth': '成长期',
      'stage.maturity': '成熟期',
      'stage.decline': '衰退期',

      // Stage descriptions
      'stageDesc.infancy': '早期研发阶段。进展缓慢，投入高，许多死胡同。专注于基础研究。',
      'stageDesc.growth': '快速改进阶段。突破加速发展。大量投资获得回报。市场接受度提高。',
      'stageDesc.maturity': '收益递减。大部分简单问题已解决。仅 incremental 改进。专注于降低成本。',
      'stageDesc.decline': '技术正在被替代。新的S曲线出现。撤资并过渡到下一代技术。',

      // Stage strategies
      'stageStrategy.infancy': '投资基础研究。保护知识产权。探索多种方案。接受高失败率。',
      'stageStrategy.growth': '加速发展。扩大生产。建立市场地位。积极申请专利。',
      'stageStrategy.maturity': '优化成本和可靠性。最大化价值。开始投资下一代技术。',
      'stageStrategy.decline': '减少投资。将客户迁移到S2技术。收获剩余利润。剥离资产。',

      // TRL titles
      'trl.1': '观察到基本原理',
      'trl.2': '技术概念形成',
      'trl.3': '实验概念验证',
      'trl.4': '实验室组件验证',
      'trl.5': '相关环境组件验证',
      'trl.6': '相关环境系统/子系统模型',
      'trl.7': '运行环境系统原型',
      'trl.8': '实际系统完成并合格',
      'trl.9': '实际系统在常规使用中验证',

      // TRL descriptions
      'trlDesc.1': '观察和报告基本原理。科学研究开始转化为应用研究。',
      'trlDesc.2': '技术概念和/或应用已形成。发明开始，但无可用证据。',
      'trlDesc.3': '启动积极研发。获得分析和实验概念验证。',
      'trlDesc.4': '实验室环境中的组件和/或面包板验证。',
      'trlDesc.5': '相关环境中的组件验证。显著提高保真度。',
      'trlDesc.6': '相关环境中系统/子系统模型或原型演示。',
      'trlDesc.7': '运行环境中系统原型演示。',
      'trlDesc.8': '实际系统已完成并通过测试和演示验证。',
      'trlDesc.9': '实际系统通过常规使用中的成功任务操作验证。',

      // Milestone labels
      'milestone.invention': '发明',
      'milestone.breakthrough': '突破',
      'milestone.commercialization': '商业化',
      'milestone.standardization': '标准化',
      'milestone.peak': '巅峰',
      'milestone.decline': '衰退',

      // SVG labels
      'svg.inflectionPoint': '拐点',
      'svg.crossover': 'S1/S2 交叉点',
      'svg.s1Peak': 'S1 峰值',
      'svg.timeAxis': '时间（年）',
      'svg.s1Current': 'S1: 当前技术',
      'svg.s2Next': 'S2: 下一代',
      'svg.realData': '真实数据点',
      'svg.analysisSummary': '分析摘要',
      'svg.strategy': '策略',
      'svg.keyEvents': '关键事件',
      'svg.scurveAnalysis': 'S曲线分析',
      'svg.currentStage': '当前阶段',
      'svg.s2Stage': 'S2 阶段',
      'svg.crossoverYear': '交叉年份',
      'svg.maxS1': 'S1 最大值',
      'svg.maxS2': 'S2 最大值',

      // Report labels
      'report.title': 'TRIZ 研究报告',
      'report.problem': '问题',
      'report.date': '日期',
      'report.executiveSummary': '执行摘要',
      'report.priorArtAnalysis': '现有技术分析',
      'report.patentLandscape': '专利格局',
      'report.academicResearch': '学术研究',
      'report.techSolutions': '技术方案',
      'report.keyInsight': '关键洞察',
      'report.contradictionAnalysis': '矛盾分析',
      'report.improvingParameter': '改善参数',
      'report.worseningParameter': '恶化参数',
      'report.recommendedPrinciples': '推荐原理',
      'report.technologyMaturity': '技术成熟度评估',
      'report.summary': '摘要',
      'report.currentTechnology': '当前技术 (S1)',
      'report.nextGenTechnology': '下一代技术 (S2)',
      'report.strategicWarning': '战略警告',
      'report.criticalAlert': '紧急警告',
      'report.recommendations': '建议',
      'report.immediateActions': '立即行动',
      'report.researchPriorities': '研究优先级',
      'report.analysisErrors': '分析错误与警告',
      'report.metadata': '研究元数据',
      'report.duration': '持续时间',
      'report.sourcesUsed': '使用数据源',
      'report.aiCalls': 'AI 调用次数',
      'report.errors': '错误数',
      'report.sCurveStage': 'S曲线阶段',
      'report.trl': '技术就绪指数',
      'report.confidence': '置信度',
      'report.dataPoints': '数据点',
      'report.estimated': '估计',
      'report.real': '真实',
      'report.metric': '指标',
      'report.value': '值',
      'report.sCurveCrossover': 'S曲线交叉点',
      'report.scurveVisualization': 'S曲线可视化',
      'report.keyEventsMilestones': '关键事件与里程碑',
      'report.year': '年份',
      'report.event': '事件',
      'report.type': '类型',
      'report.aiEstimate': 'AI 估计',
      'report.aiEstimatedData': 'AI 估计数据',
      'report.strategy': '策略',
      'report.patentLandscapeSummary': '专利格局揭示了',
      'report.keyPlayers': '主要参与者包括',
      'report.patentsSpan': '专利时间跨度从',
      'report.indicating': '表明',
      'report.academicSummary': '学术研究提供了',
      'report.recentWork': '最近的工作由',
      'report.demonstrates': '展示了',
      'report.techSolutionSummary': '实际实现展示了',
      'report.show': '这些方案显示',
      'report.maturityHigh': '高度成熟的技术，已证明商业可行性。重点应转向优化和降低成本。',
      'report.maturityMid': '接近商业就绪的技术。加速验证并准备进入市场。',
      'report.maturityLow': '积极开发中的技术，前景良好。继续原型设计并寻求合作。',
      'report.maturityEarly': '高潜力但开发风险大的新兴技术。投资基础研究。',
      'report.strategyInvest': '投资基础研究。探索多种方法。保护知识产权。接受高失败率。',
      'report.strategyAccelerate': '加速发展。扩大生产。建立市场地位。积极申请专利。',
      'report.strategyOptimize': '优化成本和可靠性。提取最大价值。开始投资下一代技术。',
      'report.strategyPhaseOut': '逐步减少投资。将客户迁移到下一代技术。收获剩余利润。',
      'report.years': '年',
      'report.willSurpass': '下一代技术将在',
      'report.beginInvesting': '现在开始投资S2技术以保持竞争优势。',
      'report.hasSurpassed': '下一代技术已超过当前性能。',
      'report.immediateTransition': '需要立即过渡到S2。',
      'report.svgChart': 'SVG 图表',
      'report.asciiPreview': 'ASCII 预览',
      'report.applyPrinciple': '应用TRIZ原理',
      'report.reviewPatents': '审查已识别的',
      'report.identifiedPatents': '项已识别专利以绘制竞争格局并识别空白机会。',
      'report.studyPapers': '研究',
      'report.academicPapers': '篇学术论文以理解潜在解决方案的理论基础。',
      'report.techRoadmap': '基于S曲线分析，制定技术过渡计划，平衡S1优化与S2投资。',
      'report.searchKeywords': '搜索关键词',
      'report.patents': '专利',
      'report.academicPapersTitle': '学术论文',
      'report.technicalSolutions': '技术方案',
      'report.trizContradictionAnalysis': 'TRIZ 矛盾分析',
      'report.improving': '改善',
      'report.worsening': '恶化',
      'report.nextGenTRL': '下一代TRL',
      'report.crossover': '交叉点',
      'report.scurveChart': 'S曲线图表',
      'report.scurvePreview': 'S曲线预览',
      'report.noRecommendations': '暂无具体建议。请审查现有技术以获取洞察。',
      'report.urgent': '紧急',
      'report.opportunity': '机会',
      'report.earlyStage': '早期阶段',
      'report.surpassByYear': '下一代S曲线将在',
      'report.beginTransitioning': '立即开始将资源过渡到S2技术。',
      'report.continueInvesting': '继续投资S1，同时开始S2的探索性研发。',
      'report.focusResearch': '专注于基础研究和知识产权保护。',
      'report.s1CurrentTech': 'S1: 当前技术',
      'report.s2NextGenTech': 'S2: 下一代技术',
      'report.strategicInsight': '战略洞察',
      'report.trlReconciliation': 'TRL 协调',
      'report.inYears': '年后',
      'report.yearsAgo': '年前',
      'report.performanceGap': '性能差距',
      'report.higherThanS1': '高于S1',
      'report.predictedIn': 'S2交叉点预计在',
      'report.exceedAround': 'S2性能将在',
      'report.reducingCosts': '减少成本和资源消耗',
      'report.eliminatingHarms': '消除有害功能和副作用',
      'report.increasingBenefits': '增加有用功能和收益',
      'report.considerPrinciples': '考虑应用发明原理来进一步改进',
      'report.perfectIdeality': '未检测到成本或有害因素 — 请确认这是否代表系统的理想最终状态',
      'report.patentTrendGrowing': '该领域专利活动不断增长',
      'report.patentTrendMature': '该领域专利格局成熟稳定',
      'report.patentTrendEmerging': '新兴技术领域',
      'report.patentInsight': '这些专利展示了处理类似技术挑战的多种方法。分析权利要求以了解保护范围并识别设计自由空间。',
      'report.researchTrend': '该领域的学术研究不断增长，实际应用正在涌现',
      'report.researchInsight': '这些论文为潜在解决方案提供了理论基础和实验验证。重点关注高被引论文以获取最有影响力的研究。',
      'report.techSolutionTrend': '实际实现变得越来越复杂和商业可行',
      'report.techSolutionInsight': '这些解决方案展示了TRIZ原理在现实应用中的实际实现。研究它们以获取可适应特定上下文的成熟方法。',
      'report.applyTrizPrinciples': '应用TRIZ原理',
      'report.reviewRelevantPatents': '审查',
      'report.relevantPatents': '项相关专利以了解竞争格局',
      'report.studyRelevantPapers': '研究',
      'report.relevantPapers': '篇相关论文以理解理论基础',
      'report.techMature': '技术已成熟。专注于优化和成本降低。',
      'report.techDeveloping': '技术正在发展。加速开发和专利申请。',
      'report.techEarly': '技术处于早期阶段。投资基础研究。',
      'report.monitorS2': '监控S2曲线开发。目前处于',
      'report.stage': '阶段。开始下一代技术的探索性研发。',
      'report.criticalS2': '关键：S2曲线（下一代',
      'report.nextGen': '）处于',
      'report.stageTransition': '阶段。立即开始将资源过渡到S2技术。',
      'report.description': '描述',
      'report.growthRate': '增长率',
      'report.inflectionPoint': '拐点',
      'report.mostLikely': '最可能',
      'report.userProvided': '用户提供',
      'report.yourTech': '你的技术',
      'report.isInStage': '处于',
      'report.found': '项',
      'report.authors': '作者',
      'report.source': '来源',
      'report.reasoning': '推理',
      'report.analysisQuality': '分析质量',
      'report.warnings': '警告',
      'report.reviewErrors': '查看错误部分了解详情。',
      'report.keyInsights': '关键洞察',
      'report.recommendedApproach': '推荐方法',
      'report.supportingPriorArt': '支撑文献',
      'report.relatedWork': '相关工作',
      'report.solutionPath': '解决路径',
      'report.references': '参考文献',
      'report.relevance': '相关性',
      'report.keyFindings': '关键发现',
      'report.principles': '原理',
      'report.acceleratePrototyping': '加速原型设计和验证',
      'report.investResearch': '投资基础研究',
      'report.patentQueryEn': '专利 (EN)',
      'report.patentQueryZh': '专利 (ZH)',
      'report.paperQueryEn': '论文 (EN)',
      'report.paperQueryZh': '论文 (ZH)',
      'report.techQueryEn': '技术方案 (EN)',
      'report.techQueryZh': '技术方案 (ZH)',
      'report.typePatent': '专利',
      'report.typePaper': '论文',
      'report.typeTech': '技术',
      'report.categoryPatents': '专利',
      'report.categoryAcademicPapers': '学术论文',
      'report.summaryNotAvailable': '暂无摘要',
      'report.methodologyTitle': '研究方法',
      'report.researchMetadata': '研究元数据',
      'report.cacheHits': '缓存命中',
      'report.cacheMisses': '缓存未命中',

      // Progress messages
      'progress.extractingKeywords': 'AI 正在提取优化搜索关键词...',
      'progress.searching': '正在搜索专利、论文和技术方案...',
      'progress.foundResults': '找到',
      'progress.patents': '项专利',
      'progress.papers': '篇论文',
      'progress.techSolutions': '个技术方案',
      'progress.analyzingSummarizing': 'AI 正在分析和总结每个结果...',
      'progress.summarizationComplete': '总结完成',
      'progress.extractingTRIZ': 'AI 正在提取TRIZ参数并分析矛盾...',
      'progress.extracted': '已提取',
      'progress.runningTRIZ': '正在运行TRIZ矛盾矩阵查找、S曲线分析和TRL评估...',
      'progress.trizComplete': 'TRIZ分析完成',
      'progress.principles': '个原理',
      'progress.lookingUpMatrix': '查找矩阵',
      'progress.foundPrinciples': '找到',
      'progress.couldNotResolve': '无法解析参数',
      'progress.searchFailed': '搜索失败',
      'progress.callingTool': '调用工具',
      'progress.extractingSCurve': '正在提取S曲线数据',
      'progress.dataPoints': '数据点',
      'progress.fittingCurve': '正在拟合逻辑曲线并检测阶段...',
      'progress.stage': '阶段',
      'progress.crossover': '交叉点',
      'progress.svgSaved': 'SVG已保存到',
      'progress.contradictionFailed': '矛盾分析失败',
      'progress.sCurveFailed': 'S曲线/TRL分析失败',
      'progress.noRealData': '未找到真实S曲线数据。使用AI估计数据点。结果为近似值。',
      'progress.failedInit': '初始化AI代理失败',
      'progress.failedParse': '解析AI分析响应为JSON失败',
      'progress.failedSearch': '未找到现有技术。结果可能不太可靠。',
      'progress.failedAnalyze': 'AI分析失败',
      'progress.summarizingResults': '正在总结搜索结果以生成报告...',
      'report.noReportGenerated': '研究未能生成有效报告，请检查错误详情。',
      'progress.failedTRIZ': 'TRIZ分析失败',
    },
  },
};

export const SERVICE_KEYS: Record<string, { zh: string; en: string }> = {
  executiveSummaryContradiction: {
    zh: '本分析识别出 **{{principles}} 个TRIZ发明原理** 可以解决你问题中的核心矛盾。我们找到了 **{{total}} 个相关现有技术项**（{{patents}} 项专利，{{papers}} 篇论文，{{tech}} 个技术方案）。',
    en: 'This analysis identified **{{principles}} TRIZ inventive principles** to resolve the core contradiction in your problem. We found **{{total}} relevant prior art items** ({{patents}} patents, {{papers}} papers, {{tech}} tech solutions).',
  },
  executiveSummaryNoContradiction: {
    zh: '我们找到了 **{{total}} 个相关现有技术项**（{{patents}} 项专利，{{papers}} 篇论文，{{tech}} 个技术方案）与你的问题相关。',
    en: 'We found **{{total}} relevant prior art items** ({{patents}} patents, {{papers}} papers, {{tech}} tech solutions) relevant to your problem.',
  },
  maturitySummary: {
    zh: '该技术目前处于 **TRL {{trl}}/9** ({{trlTitle}}){{estBadge}}，S曲线阶段为 **{{stage}}**，下一代解决方案预计在 **{{year}}** 年左右超越当前性能。',
    en: 'The technology is currently at **TRL {{trl}}/9** ({{trlTitle}}){{estBadge}}, S-curve stage **{{stage}}**, with next-gen solutions predicted to surpass current performance around **{{year}}**.',
  },
  principlesIntro: {
    zh: '核心矛盾可以通过 **{{count}} 个TRIZ发明原理** 解决：',
    en: 'The core contradiction can be resolved through **{{count}} TRIZ inventive principles**:',
  },
  principleItemPrefix: { zh: '原理', en: 'Principle' },
  methodologyText: {
    zh: '本报告采用以下方法生成：\n- 现有技术检索：使用OpenAlex、CrossRef等学术API检索专利({{patentCount}}项)、论文({{paperCount}}篇)和技术方案({{techCount}}个)\n- 矛盾分析({{hasContradiction}})：应用TRIZ矛盾矩阵查找改进/恶化参数对应的发明原理\n- 技术成熟度评估({{hasMaturity}})：结合S曲线拟合和TRL评估\n- 数据来源标注：AI估计数据以斜体标记，真实检索数据不标记\n',
    en: 'This report was generated using:\n- Prior art search: OpenAlex, CrossRef and other academic APIs ({{patentCount}} patents, {{paperCount}} papers, {{techCount}} tech solutions)\n- Contradiction analysis ({{hasContradiction}}): TRIZ contradiction matrix for improving/worsening parameters\n- Technology maturity assessment ({{hasMaturity}}): S-curve fitting + TRL assessment\n- Data source provenance: AI-estimated data is marked in italics; real retrieved data is unmarked\n',
  },
  maturityDetailIntro: {
    zh: '该技术目前处于 **TRL {{trl}}/9** ({{trlTitle}}){{estBadge}}，S曲线阶段为 **{{stage}}**{{dataBadge}}。这表明 {{maturitySummary}}。下一代技术预计在未来几年内达到 TRL {{trlNextMostLikely}}，预测交叉点在 **{{crossoverYear}}** 年左右。',
    en: 'The technology is currently at **TRL {{trl}}/9** ({{trlTitle}}){{estBadge}}, S-curve stage **{{stage}}**{{dataBadge}}. This indicates {{maturitySummary}}. Next-gen tech is expected to reach TRL {{trlNextMostLikely}} in the next few years, with the predicted crossover around **{{crossoverYear}}**.',
  },
  noDates: { zh: '不同时期', en: 'various periods' },
  dateRange: { zh: '{{start}} 至 {{end}}', en: '{{start}} to {{end}}' },
  multipleTeams: { zh: '多个研究团队', en: 'multiple research teams' },
  patentTrendGrowing: { zh: '该领域创新活跃且不断增长', en: 'active and growing innovation in this field' },
  patentTrendMature: { zh: '成熟但不断发展的创新格局', en: 'a mature but evolving innovation landscape' },
  patentTrendActive: { zh: '持续的研究活动', en: 'ongoing research activity' },
  patentInsightText: {
    zh: '这些专利代表了当前的技术水平。审查它们以识别空白机会并避免侵权。考虑在现有现有技术未覆盖的领域申请专利。',
    en: 'These patents represent the current state of the art. Review them to identify white space opportunities and avoid infringement. Consider filing patents in areas not covered by existing prior art.',
  },
  recommendationDeepDive: {
    zh: '深入研究最具潜力的成果：「{{title}}」({{sourceType}})。[查看详情]({{url}})',
    en: 'Deep-dive into the most promising result: "{{title}}" ({{sourceType}}). [View details]({{url}})',
  },
  recommendationCostFocus: {
    zh: '根据成本优化偏好，优先考虑原理 {{principle}}，可参考相关低成本和复合材料替代方案。',
    en: 'Based on cost-optimization preference, prioritize principle {{principle}} — explore low-cost and composite material alternatives.',
  },
  recommendationPerfFocus: {
    zh: '根据性能优先偏好，重点应用原理 {{principle}}，可参考动态性和分割策略提升系统效能。',
    en: 'Based on performance-first preference, focus on principle {{principle}} — leverage dynamization and segmentation for efficiency gains.',
  },
  patentInsightDynamic: {
    zh: '共检索到 {{count}} 件相关专利（{{yearRange}}），涉及约 {{assigneeCount}} 个专利权人/发明人。关键参与者包括 {{authors}}。趋势：{{trend}}。建议重点分析高引专利及其引用网络。',
    en: 'Found {{count}} relevant patents ({{yearRange}}), involving ~{{assigneeCount}} assignees/inventors. Key players include {{authors}}. Trend: {{trend}}. Focus on high-citation patents and their citation networks.',
  },
  researchInsightDynamic: {
    zh: '共检索到 {{count}} 篇相关论文（{{yearRange}}），来自约 {{institutionCount}} 个研究机构/团队。核心研究人员包括 {{authors}}。趋势：{{trend}}。建议优先关注近期高被引论文及综述文章。',
    en: 'Found {{count}} relevant papers ({{yearRange}}), from ~{{institutionCount}} research groups. Core researchers include {{authors}}. Trend: {{trend}}. Prioritize recent high-citation papers and review articles.',
  },
  techSolutionInsightDynamic: {
    zh: '共检索到 {{count}} 个技术方案（{{yearRange}}），来自约 {{sourceCount}} 个来源。趋势：{{trend}}。建议对比不同方案的技术路线和成熟度，提取可复用的设计模式。',
    en: 'Found {{count}} technical solutions ({{yearRange}}), from ~{{sourceCount}} sources. Trend: {{trend}}. Compare technical approaches and maturity levels to extract reusable design patterns.',
  },
  contradictionInsightSegment: { zh: '将系统分解为更小、更易管理的组件', en: 'breaking the system into smaller, more manageable components' },
  contradictionInsightDynamic: { zh: '使系统适应变化的条件', en: 'making the system adaptable to changing conditions' },
  contradictionInsightComposite: { zh: '使用复合材料或结构', en: 'using composite materials or structures' },
  contradictionInsightDefault: { zh: '结合多种发明方法来解决矛盾', en: 'combining multiple inventive approaches to resolve the contradiction' },
};

export function srv(key: string, lang: Language, vars?: Record<string, string | number>): string {
  const map = SERVICE_KEYS[key];
  let text = map ? (map[lang] || map.en || key) : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
    }
  }
  return text;
}

export interface LocaleConfig {
  language: Language;
}

export const DEFAULT_LOCALE: LocaleConfig = { language: 'zh' };

function ensureInit(lang: Language = 'zh') {
  if (!initialized) {
    i18next.init({
      lng: lang,
      fallbackLng: 'en',
      resources,
      interpolation: {
        escapeValue: false,
      },
    });
    initialized = true;
    currentLang = lang;
  }
}

export function t(key: string, langOrOptions?: Language | Record<string, unknown>): string {
  let options: Record<string, unknown>;

  if (typeof langOrOptions === 'string') {
    ensureInit(langOrOptions);
    options = { lng: langOrOptions };
  } else if (langOrOptions && langOrOptions.lng) {
    ensureInit(langOrOptions.lng as Language);
    options = langOrOptions;
  } else {
    ensureInit();
    options = {};
  }

  const fullKey = key.includes('.') ? key : `report.${key}`;
  return (i18next.t(fullKey, options as any) || i18next.t(key, options as any)) as string;
}

export function stageLabel(stage: string, lang: Language): string {
  ensureInit(lang);
  return i18next.t(`stage.${stage}`, { lng: lang });
}

export function stageDesc(stage: string, lang: Language): string {
  ensureInit(lang);
  return i18next.t(`stageDesc.${stage}`, { lng: lang });
}

export function stageStrategy(stage: string, lang: Language): string {
  ensureInit(lang);
  return i18next.t(`stageStrategy.${stage}`, { lng: lang });
}

export function trlTitle(level: number, lang: Language): string {
  ensureInit(lang);
  return i18next.t(`trl.${level}`, { lng: lang });
}

export function trlDesc(level: number, lang: Language): string {
  ensureInit(lang);
  return i18next.t(`trlDesc.${level}`, { lng: lang });
}

export function milestoneLabel(type: string, lang: Language): string {
  ensureInit(lang);
  return i18next.t(`milestone.${type}`, { lng: lang });
}

export function svgLabel(key: string, lang: Language): string {
  ensureInit(lang);
  return i18next.t(`svg.${key}`, { lng: lang });
}

export function getLanguagePrompt(lang: Language): string {
  return lang === 'zh'
    ? '请用中文回答。所有汉字必须为有效 UTF-8，不可出现乱码、缺字或编码错误。'
    : 'Please respond in English. All characters must be valid UTF-8 — no garbled text, no mojibake.';
}

export function progressMsg(key: string, lang: Language): string {
  ensureInit(lang);
  return i18next.t(`progress.${key}`, { lng: lang });
}
