SVGO_BASE_CONFIG = {
					"multipass": True,
					"floatPrecision": 5,
					"js2svg": {
						"indent": "\t",
						"pretty": True,
						"eol": "lf",
						"finalNewline": True,
					},
					"plugins": [
						{
							"name": "preset-default",
							"params": {
								"overrides": {
									"convertPathData": {
										"forceAbsolutePath": True,
										"applyTransforms": True,
										"utilizeAbsolute": True,
									},
                                    "convertColors":{
                                        "shortname":False,
                                    },
                                    "removeUselessDefs":False
								},
							},
						},
                        {
                            "name": "removeUselessStrokeAndFill",
                            "params": {
                                "stroke": True,
                                "fill": True,
                                "removeNone": True
                            }
                        },
						"removeDimensions",
						"removeHiddenElems",
                        "moveGroupAttrsToElems",
                        "cleanupAttrs",
                        "collapseGroups",
                        "convertStyleToAttrs",
					],
				}