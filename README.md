# MScCSE

Master's thesis in Computational Science and Engineering (CSE).

- __Title__: Refinement for Game-Based Abstractions of Continuous-Space Linear Stochastic Systems
- __Submitted__: 2019-05-13 to the Department of Informatics at the Technical University Munich
- Thesis pdf available [here](MSc-Polster-Refinement-Thesis.pdf)
- Interactive LSS abstraction [inspector](https://chpolste.github.io/MScCSE/software/dist/inspector.html) application


## Abstract

The verification of a hybrid system is considered: Compute the set of initial states of a discrete-time linear stochastic system such that there exists a control strategy which guarantees that all traces starting from this set fulfill a temporal logic specification from the GR(1) fragment of linear temporal logic almost-surely. This problem has previously been posed and solved by [Svoreňová et al. (2017)](https://doi.org/10.1016/j.nahs.2016.04.006). Their approach utilizes a turn-based 2-player probabilistic game abstraction which is analysed with a model checking procedure and iteratively refined based on the analysis results and dynamics of the system.

Starting from this procedure, refinement methods are developed that extend the capabilities and effectiveness of those introduced by Svoreňová et al. (2017). Holistic refinement procedures are proposed that match problematic patterns in the abstraction and break them up through refinement of the state space partition guided by the system dynamics. Based on robust dynamics and the decomposition of a system into a series of co-safe reachability problems induced by the transitions of the objective automaton, a multi-step refinement framework is set up. The framework is configurable and can adapt to the requirements of specific problems.

The developed refinement techniques are applied in two case studies, a reachability problem and a system with a more complex recurrence objective. The cases show that that the robust framework is able to significantly reduce the size of the state space partition compared to previous methods, thereby improving the performance of the verification procedure. Its multi-step nature is able to ensure progress also for rich specifications.

Finally, a browser-based application for interactive visualization and exploration of the considered problem and its solution scheme is presented.  It serves as an educational tool and experimentation platform and was used in the development of refinement procedures.


## Repository Information

- This repository contains both software and TeX sources.
- All files in folder [software](software) are licensed under the terms of the MIT license (see [software/LICENSE](software/LICENSE)).

