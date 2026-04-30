---
id: KB-concept-fuzzy-pid
type: concept
tags: [模糊PID, 模糊控制, 速度环, 自适应]
source: 案例提取 - 永磁同步电机simulink伺服控制
created: 2026-04-30
---

# 模糊PID速度控制器

## 架构

在传统PI速度环基础上，通过模糊推理实时调整Kp和Ki:
- 输入: 速度误差 e 和误差变化率 ec
- 输出: ΔKp, ΔKi (PI参数修正量)

## 模糊推理系统配置

### 隶属函数 (7个)
| 缩写 | 含义 | 对应值 |
|------|------|--------|
| NB | Negative Big | 负大 |
| NM | Negative Medium | 负中 |
| NS | Negative Small | 负小 |
| ZO | Zero | 零 |
| PS | Positive Small | 正小 |
| PM | Positive Medium | 正中 |
| PB | Positive Big | 正大 |

### 规则表 (49条/输出)
7×7规则矩阵，输入为(e, ec)，输出为ΔKp或ΔKi。

### 推理方法
- 类型: Mamdani
- 去模糊化: 重心法(Centroid)

### .fis文件
模糊推理系统保存在 `.fis` 文件中，可由MATLAB的 `readfis()` 加载。

## 预期性能 (PMSM案例)

| 指标 | 目标值 |
|------|--------|
| 超调量 | <5% |
| 建立时间 | <0.1s |
| 稳态误差 | <1rpm |

## 关联知识
- KB-concept-vector-control-foc — FOC控制框架
- KB-concept-pmsm-math-model — PMSM参数
