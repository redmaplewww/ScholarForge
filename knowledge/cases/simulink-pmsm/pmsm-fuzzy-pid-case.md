---
id: KB-case-pmsm-fuzzy-pid
type: case
tags: [PMSM, FOC, 模糊PID, SVPWM, 完整案例]
source: 案例提取 - 永磁同步电机simulink伺服控制电机.docx
created: 2026-04-30
---

# PMSM + Fuzzy-PID 完整案例

## 概况

- 电机类型: 表贴式永磁同步电机(PMSM)
- 额定功率: 1.5kW
- 额定转速: 3000rpm
- 控制策略: FOC/id=0 + SVPWM + Fuzzy-PID速度环

## 电机参数

| 参数 | 数值 | 单位 |
|------|------|------|
| Rs | 2.875 | Ω |
| Ld = Lq | 0.0085 | H |
| ψ_f | 0.175 | Wb |
| pn | 4 | |
| J | 0.0008 | kg·m² |
| B (摩擦系数) | 0 | N·m·s |

## 控制架构

- 电流环: 双PI控制器(d轴/q轴各一个)
- 速度环: Fuzzy-PID控制器
- 调制方式: SVPWM, 10kHz
- 坐标变换: Clarke + Park

## Fuzzy-PID配置

- 模糊推理系统: Mamdani类型
- 输入: e (速度误差), ec (误差变化率)
- 输出: ΔKp, ΔKi
- 隶属函数: 7个 (NB, NM, NS, ZO, PS, PM, PB)
- 规则数: 49条/输出
- 去模糊化: 重心法(Centroid)
- FIS文件: fuzzypid.fis

## 仿真配置

- Solver: ode15s (stiff系统)
- 最大步长: 1e-5s
- 仿真时长: 0.5s
- 负载转矩阶跃: 0.1s时施加

## 预期性能

| 指标 | 目标值 |
|------|--------|
| 速度超调量 | <5% |
| 建立时间 | <0.1s |
| 稳态速度误差 | <1rpm |
| 电流THD | <5% |

## 关联文件

- PMSM.slx — Simulink模型
- fuzzypid.fis — 模糊PID推理系统
- 永磁同步电机simulink伺服控制电机.docx — 设计文档

## 关联知识
- KB-concept-pmsm-math-model
- KB-concept-vector-control-foc
- KB-concept-svpwm
- KB-concept-fuzzy-pid
