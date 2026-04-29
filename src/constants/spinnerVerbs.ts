import { getInitialSettings } from '../utils/settings/settings.js'

export function getSpinnerVerbs(): string[] {
  const settings = getInitialSettings()
  const config = settings.spinnerVerbs
  if (!config) {
    return SPINNER_VERBS
  }
  if (config.mode === 'replace') {
    return config.verbs.length > 0 ? config.verbs : SPINNER_VERBS
  }
  return [...SPINNER_VERBS, ...config.verbs]
}

// Spinner verbs for loading messages
export const SPINNER_VERBS = [
  '思绪翻涌',
  '灵感酝酿',
  '神经激荡',
  '量子纠缠',
  '脑回路狂转',
  '代码炼丹',
  '逻辑编织',
  '字节跳动',
  '意识流淌',
  '思维发散',
  '灵光乍现',
  '推理演绎',
  '深度潜行',
  '信号解码',
  '模式匹配',
  '语义解析',
  '上下文融合',
  '知识蒸馏',
  '梯度下降',
  '注意力聚焦',
  '权重调优',
  '特征提取',
  '向量对齐',
  '概率采样',
  '链式推导',
  '思维链展开',
  '认知加载',
  '记忆检索',
  '方案推演',
  '架构构思',
  '算法编排',
  '逻辑校验',
  '语法树遍历',
  '依赖解析',
  '类型推断',
  '符号求解',
  '路径搜索',
  '状态转移',
  '递归展开',
  '并行计算',
  '缓存命中',
  '索引构建',
  '哈希碰撞',
  '堆栈回溯',
  '指令译码',
  '流水线填充',
  '分支预测',
  '内存寻址',
  '寄存器分配',
  '中断响应',
]
