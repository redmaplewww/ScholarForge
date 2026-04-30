---
id: KB-concept-pmsm-math-model
type: concept
tags: [PMSM, 数学模型, 电机, dq坐标系]
source: 案例提取 - 永磁同步电机simulink伺服控制
created: 2026-04-30
---

# PMSM(永磁同步电机)数学模型

## dq坐标系下的电压方程

$$
u_d = R_s i_d + L_d \frac{di_d}{dt} - \omega_e L_q i_q
$$

$$
u_q = R_s i_q + L_q \frac{di_q}{dt} + \omega_e (L_d i_d + \psi_f)
$$

## 电磁转矩方程

$$
T_e = \frac{3}{2} p_n [i_q \psi_f + (L_d - L_q) i_d i_q]
$$

当采用id=0控制策略时:

$$
T_e = \frac{3}{2} p_n \psi_f i_q
$$

## 运动方程

$$
J \frac{d\omega_m}{dt} = T_e - T_L - B\omega_m
$$

## 典型PMSM参数

| 参数 | 符号 | 数值 | 单位 | 说明 |
|------|------|------|------|------|
| 定子电阻 | R_s | 2.875 | Ω | |
| d轴电感 | L_d | 0.0085 | H | 表贴式L_d=L_q |
| q轴电感 | L_q | 0.0085 | H | |
| 永磁体磁链 | ψ_f | 0.175 | Wb | |
| 极对数 | p_n | 4 | | |
| 转动惯量 | J | 0.0008 | kg·m² | |
| 额定功率 | P_N | 1.5 | kW | |
| 额定转速 | n_N | 3000 | rpm | |

## 关联知识
- KB-concept-vector-control-foc — 矢量控制策略
- KB-concept-svpwm — 空间矢量PWM
