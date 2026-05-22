export interface InventivePrinciple {
  index: number;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  examples: string[];
}

export const INVENTIVE_PRINCIPLES: ReadonlyArray<InventivePrinciple> = [
  { index: 1, name: 'Segmentation', nameZh: '分割', description: 'Divide an object into independent parts', descriptionZh: '将物体分成独立的部分', examples: ['Modular furniture', 'Assembly line production'] },
  { index: 2, name: 'Taking out', nameZh: '抽取', description: 'Separate an interfering part or isolate the necessary part', descriptionZh: '将干扰部分分离或仅提取必要部分', examples: ['Noise barriers', 'Remote sensors'] },
  { index: 3, name: 'Local quality', nameZh: '局部质量', description: 'Change an object\'s structure from uniform to non-uniform', descriptionZh: '将物体的均匀结构改为非均匀', examples: ['Ergonomic tools', 'Gradient materials'] },
  { index: 4, name: 'Asymmetry', nameZh: '不对称', description: 'Change the shape of an object from symmetrical to asymmetrical', descriptionZh: '将物体的对称形状改为不对称', examples: ['Asymmetric tires', 'One-way valves'] },
  { index: 5, name: 'Merging', nameZh: '合并', description: 'Bring closer together identical or similar objects', descriptionZh: '将相同或相似的物体靠近或合并', examples: ['Multi-core processors', 'Parallel computing'] },
  { index: 6, name: 'Universality', nameZh: '多用性', description: 'Make a part or object perform multiple functions', descriptionZh: '使一个部件或物体具有多种功能', examples: ['Swiss Army knife', 'Smartphone'] },
  { index: 7, name: 'Nested doll', nameZh: '嵌套', description: 'Place one object inside another', descriptionZh: '将一个物体放入另一个物体中', examples: ['Telescopic antenna', 'Russian dolls'] },
  { index: 8, name: 'Anti-weight', nameZh: '重量补偿', description: 'Compensate for the weight of an object by merging with another', descriptionZh: '通过与其他物体合并来补偿重量', examples: ['Helium balloons', 'Counterweights'] },
  { index: 9, name: 'Preliminary anti-action', nameZh: '预先反作用', description: 'If it is necessary to perform an action with both harmful and useful effects, use anti-action', descriptionZh: '如果需要同时产生有害和有益效果的动作，使用反作用', examples: ['Pre-stressed concrete', 'Buffer solutions'] },
  { index: 10, name: 'Preliminary action', nameZh: '预先作用', description: 'Perform the required change before it is needed', descriptionZh: '在需要之前执行所需的变化', examples: ['Pre-cut materials', 'Pre-positioned tools'] },
  { index: 11, name: 'Beforehand cushioning', nameZh: '事先防范', description: 'Compensate for relatively low reliability by arranging countermeasures beforehand', descriptionZh: '通过事先安排补偿措施来补偿较低可靠性', examples: ['Safety belts', 'Backup systems'] },
  { index: 12, name: 'Equipotentiality', nameZh: '等势性', description: 'Change the working conditions to eliminate the need for raising or lowering', descriptionZh: '改变工作条件以消除升降的需要', examples: ['Assembly line height adjustment', 'Loading docks'] },
  { index: 13, name: 'The other way around', nameZh: '反向作用', description: 'Invert the action(s) used to solve the problem', descriptionZh: '反转用于解决问题的动作', examples: ['Cooling by heating', 'Moving treadmill instead of runner'] },
  { index: 14, name: 'Spheroidality', nameZh: '曲面化', description: 'Change from linear parts to curved surfaces', descriptionZh: '从线性部件改为曲面', examples: ['Ball bearings', 'Dome structures'] },
  { index: 15, name: 'Dynamics', nameZh: '动态化', description: 'Allow characteristics of an object or environment to change to be optimal', descriptionZh: '允许物体或环境的特性变化以达到最佳', examples: ['Adjustable steering wheel', 'Flexible hoses'] },
  { index: 16, name: 'Partial or excessive actions', nameZh: '不足或过度作用', description: 'If 100% of an effect is hard to achieve, use slightly less or more', descriptionZh: '如果难以达到100%的效果，使用略少或略多', examples: ['Overfilling then trimming', 'Partial coating'] },
  { index: 17, name: 'Another dimension', nameZh: '多维化', description: 'Move an object in two or three dimensional space', descriptionZh: '将物体在二维或三维空间中移动', examples: ['Multi-story buildings', '3D printing'] },
  { index: 18, name: 'Mechanical vibration', nameZh: '机械振动', description: 'Cause an object to oscillate or vibrate', descriptionZh: '使物体振荡或振动', examples: ['Ultrasonic cleaning', 'Vibratory feeders'] },
  { index: 19, name: 'Periodic action', nameZh: '周期性作用', description: 'Replace continuous action with periodic or pulsating', descriptionZh: '用周期性或脉动动作替代连续动作', examples: ['Pulsed lasers', 'Intermittent wipers'] },
  { index: 20, name: 'Continuity of useful action', nameZh: '有效作用连续性', description: 'Carry on work continuously; avoid idle or intermediate actions', descriptionZh: '持续工作；避免空闲或中间动作', examples: ['Continuous production', 'Flywheel energy storage'] },
  { index: 21, name: 'Skipping', nameZh: '紧急行动', description: 'Conduct a process or certain stages at high speed', descriptionZh: '高速执行某个过程或某些阶段', examples: ['Quick-change tooling', 'Rapid prototyping'] },
  { index: 22, name: 'Blessing in disguise', nameZh: '变害为利', description: 'Turn harmful factors into secondary benefits', descriptionZh: '将有害因素转化为次要利益', examples: ['Waste heat recovery', 'Byproduct utilization'] },
  { index: 23, name: 'Feedback', nameZh: '反馈', description: 'Introduce feedback to improve a process or action', descriptionZh: '引入反馈以改进过程或动作', examples: ['Thermostat control', 'Quality control loops'] },
  { index: 24, name: 'Intermediary', nameZh: '中介物', description: 'Use an intermediary carrier article or intermediary process', descriptionZh: '使用中介载体或中介过程', examples: ['Mediator in negotiations', 'Carrier proteins'] },
  { index: 25, name: 'Self-service', nameZh: '自服务', description: 'Make an object serve itself by performing auxiliary functions', descriptionZh: '使物体通过执行辅助功能为自己服务', examples: ['Self-cleaning ovens', 'Self-healing materials'] },
  { index: 26, name: 'Copying', nameZh: '复制', description: 'Use a simplified and inexpensive copy instead of an unavailable object', descriptionZh: '使用简化且廉价的复制品替代不可用的物体', examples: ['Virtual reality', 'Photocopying'] },
  { index: 27, name: 'Cheap short-living objects', nameZh: '廉价替代品', description: 'Replace an inexpensive object with multiple inexpensive ones', descriptionZh: '用多个廉价物体替代昂贵物体', examples: ['Disposable cameras', 'Single-use medical tools'] },
  { index: 28, name: 'Mechanics substitution', nameZh: '机械系统替代', description: 'Replace a mechanical system with a non-mechanical one', descriptionZh: '用非机械系统替代机械系统', examples: ['Touch screens', 'Magnetic levitation'] },
  { index: 29, name: 'Pneumatics and hydraulics', nameZh: '气压和液压结构', description: 'Use gas or liquid parts instead of solid parts', descriptionZh: '使用气体或液体部件替代固体部件', examples: ['Hydraulic brakes', 'Pneumatic tools'] },
  { index: 30, name: 'Flexible shells and thin films', nameZh: '柔性壳体或薄膜', description: 'Use flexible shells and thin films instead of three-dimensional structures', descriptionZh: '使用柔性壳体或薄膜替代三维结构', examples: ['Bubble wrap', 'Greenhouse films'] },
  { index: 31, name: 'Porous materials', nameZh: '多孔材料', description: 'Make an object porous or add porous elements', descriptionZh: '使物体多孔或添加多孔元素', examples: ['Filter membranes', 'Breathable fabrics'] },
  { index: 32, name: 'Color changes', nameZh: '颜色改变', description: 'Change the color of an object or its external environment', descriptionZh: '改变物体或其外部环境的颜色', examples: ['Thermal imaging', 'pH indicators'] },
  { index: 33, name: 'Homogeneity', nameZh: '同质性', description: 'Make objects interacting with a given object of the same material', descriptionZh: '使与给定物体相互作用的物体使用相同材料', examples: ['Diamond cutting diamond', 'Same-metal welding'] },
  { index: 34, name: 'Discarding and recovering', nameZh: '抛弃与再生', description: 'Make portions of an object that have fulfilled their functions go away', descriptionZh: '使已完成功能的部分消失', examples: ['Dissolving capsules', 'Biodegradable packaging'] },
  { index: 35, name: 'Parameter changes', nameZh: '物理化学参数改变', description: 'Change the physical state or concentration of an object', descriptionZh: '改变物体的物理状态或浓度', examples: ['Phase change materials', 'Concentrated solutions'] },
  { index: 36, name: 'Phase transition', nameZh: '相变', description: 'Use phenomena occurring during phase transitions', descriptionZh: '利用相变过程中发生的现象', examples: ['Heat pipes', 'Shape memory alloys'] },
  { index: 37, name: 'Thermal expansion', nameZh: '热膨胀', description: 'Use thermal expansion or contraction of materials', descriptionZh: '利用材料的热膨胀或收缩', examples: ['Bimetallic strips', 'Shrink fitting'] },
  { index: 38, name: 'Strong oxidants', nameZh: '强氧化剂', description: 'Replace common air with oxygen-enriched air', descriptionZh: '用富氧空气替代普通空气', examples: ['Oxygen welding', 'Ozone treatment'] },
  { index: 39, name: 'Inert atmosphere', nameZh: '惰性环境', description: 'Replace a normal environment with an inert one', descriptionZh: '用惰性环境替代正常环境', examples: ['Argon welding', 'Nitrogen packaging'] },
  { index: 40, name: 'Composite materials', nameZh: '复合材料', description: 'Change from uniform materials to composite materials', descriptionZh: '从均匀材料改为复合材料', examples: ['Carbon fiber', 'Fiberglass'] },
];

export function getPrincipleByIndex(index: number): InventivePrinciple | undefined {
  return INVENTIVE_PRINCIPLES.find(p => p.index === index);
}

export function getPrincipleByName(name: string): InventivePrinciple | undefined {
  return INVENTIVE_PRINCIPLES.find(p => p.name.toLowerCase() === name.toLowerCase());
}
